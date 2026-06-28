import { spawn } from "node:child_process";
import path from "node:path";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";
import { now } from "../utils/time.js";
import { ensureDir, appendToFile } from "../utils/fs.js";
import { getLogsDir, getOutputsDir } from "../utils/paths.js";
import { RingBuffer } from "../utils/ring-buffer.js";
import { setDetachedSpawnOptions, killProcessTree, isAlive } from "../utils/process-tree-kill.js";
import { getEventBus } from "../ui/event-bus.js";
import { ResourceGuard } from "./resource-guard.js";
import { SecretRedactor } from "../safety/secret-redactor.js";
import { buildChildEnv } from "../utils/command-sanitizer.js";

export interface ValidationCommandResult {
  command: string;
  status: "passed" | "failed" | "timeout" | "cancelled" | "skipped";
  exitCode?: number;
  startedAt: string;
  finishedAt: string;
  output?: string;
  error?: string;
  ringBuffer: RingBuffer;
  timedOut: boolean;
  cancelled: boolean;
  resourceWarnings: string[];
}

export interface ValidationRunParams {
  commands: string[];
  cwd: string;
  runId: string;
  env?: Record<string, string>;
}

class DedupeCache {
  private completed = new Map<string, ValidationCommandResult>();
  private running = new Set<string>();

  key(command: string, cwd: string): string {
    return `${command}::${cwd}`;
  }

  isCompleted(key: string): boolean {
    return this.completed.has(key);
  }

  getCompleted(key: string): ValidationCommandResult | undefined {
    return this.completed.get(key);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  markRunning(key: string): void {
    this.running.add(key);
  }

  markDone(key: string, result: ValidationCommandResult): void {
    this.running.delete(key);
    this.completed.set(key, result);
  }

  clear(): void {
    this.completed.clear();
    this.running.clear();
  }
}

export class ValidationRunner {
  private config: FlowTaskConfig;
  private resourceGuard: ResourceGuard;
  private dedupeCache: DedupeCache;
  private redactor: SecretRedactor;
  private activeProcesses = new Map<string, { pid: number; runId: string }>();
  private abortControllers = new Map<string, AbortController>();

  constructor(config: FlowTaskConfig) {
    this.config = config;
    this.resourceGuard = new ResourceGuard(config);
    this.dedupeCache = new DedupeCache();
    this.redactor = new SecretRedactor();
  }

  async runValidation(params: ValidationRunParams): Promise<ValidationCommandResult[]> {
    const results: ValidationCommandResult[] = [];
    const concurrency = this.config.validation?.concurrency ?? 1;
    const timeoutMs = this.config.validation?.timeoutMs ?? 300000;
    const dedupeEnabled = this.config.validation?.dedupeCommands ?? true;
    const resourceGuardEnabled = this.config.validation?.resourceGuard ?? true;
    const maxInMemoryLines = this.config.logging?.maxInMemoryLines ?? 500;
    const maxLineLength = this.config.logging?.maxLineLength ?? 4000;

    const logsDir = getLogsDir(params.cwd, params.runId);
    const outputsDir = getOutputsDir(params.cwd, params.runId);
    await ensureDir(logsDir);
    await ensureDir(outputsDir);

    const eventBus = getEventBus();

    for (let i = 0; i < params.commands.length; i++) {
      const command = params.commands[i]!;
      const safeCommand = this.resourceGuard.getSafeCommand(command);
      const executedCommand = safeFrameCommand(safeCommand);
      const cacheKey = this.dedupeCache.key(executedCommand, params.cwd);

      if (dedupeEnabled && this.dedupeCache.isCompleted(cacheKey)) {
        const cached = this.dedupeCache.getCompleted(cacheKey)!;
        results.push({
          ...cached,
          status: "skipped",
          ringBuffer: cached.ringBuffer,
          resourceWarnings: cached.resourceWarnings,
        });
        eventBus.emit({
          type: "executor_output",
          runId: params.runId,
          taskId: "validation",
          executor: "validation-runner",
          stream: "stdout",
          text: `[validation] ${command} — skipped (already completed)\n`,
        });
        continue;
      }

      if (dedupeEnabled && this.dedupeCache.isRunning(cacheKey)) {
        results.push({
          command,
          status: "skipped",
          startedAt: now(),
          finishedAt: now(),
          ringBuffer: new RingBuffer(maxInMemoryLines, maxLineLength),
          timedOut: false,
          cancelled: false,
          resourceWarnings: ["Already running — skipped duplicate"],
        });
        continue;
      }

      if (i > 0) {
        await this.delayBetweenCommands(concurrency, i, params.commands);
      }

      const abortController = new AbortController();
      this.abortControllers.set(params.runId, abortController);

      const resourceWarnings: string[] = [];
      if (resourceGuardEnabled) {
        const warnings = this.resourceGuard.inspect(command);
        for (const w of warnings) {
          resourceWarnings.push(w.message);
          if (w.suggestion) {
            resourceWarnings.push(`Suggestion: ${w.suggestion}`);
          }
          eventBus.emit({
            type: "executor_output",
            runId: params.runId,
            taskId: "validation",
            executor: "validation-runner",
            stream: "stderr",
            text: `[resource-guard] ${w.severity}: ${w.message}\n`,
          });
        }
      }

      const logLine = `[${now()}] COMMAND: ${safeCommand}\n`;
      await appendToFile(path.join(logsDir, "validation.log"), logLine);

      const result = await this.runSingleCommand({
        command: executedCommand,
        cwd: params.cwd,
        runId: params.runId,
        env: params.env,
        timeoutMs,
        maxInMemoryLines,
        maxLineLength,
        cacheKey: dedupeEnabled ? cacheKey : undefined,
        logsDir,
        abortController,
      });

      result.resourceWarnings = resourceWarnings;
      results.push(result);
    }

    return results;
  }

  cancel(runId: string): void {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }
    for (const [key, proc] of this.activeProcesses) {
      if (proc.runId === runId) {
        killProcessTree(proc.pid, "SIGTERM");
        this.activeProcesses.delete(key);
      }
    }
  }

  cancelAll(): void {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    for (const [key, proc] of this.activeProcesses) {
      killProcessTree(proc.pid, "SIGTERM");
      this.activeProcesses.delete(key);
    }
    this.abortControllers.clear();
  }

  clearDedupeCache(): void {
    this.dedupeCache.clear();
  }

  private async runSingleCommand(params: {
    command: string;
    cwd: string;
    runId: string;
    env?: Record<string, string>;
    timeoutMs: number;
    maxInMemoryLines: number;
    maxLineLength: number;
    cacheKey?: string;
    logsDir: string;
    abortController: AbortController;
  }): Promise<ValidationCommandResult> {
    const startedAt = now();
    const ringBuffer = new RingBuffer(params.maxInMemoryLines, params.maxLineLength);
    const killGraceMs = this.config.validation?.killGraceMs ?? 5000;

    const { abortController } = params;

    // If already aborted before spawn, mark cancelled immediately
    if (abortController.signal.aborted) {
      return {
        command: params.command,
        status: "cancelled",
        startedAt,
        finishedAt: now(),
        ringBuffer,
        timedOut: false,
        cancelled: true,
        resourceWarnings: [],
        error: "Validation cancelled",
      };
    }

    return new Promise<ValidationCommandResult>((resolve) => {
      let settled = false;
      const resolveOnce = (result: ValidationCommandResult): void => {
        if (settled) return;
        settled = true;
        this.abortControllers.delete(params.runId);
        if (params.cacheKey) {
          this.dedupeCache.markDone(params.cacheKey, result);
        }
        resolve(result);
      };

      const shell = getShell();
      const shellFlag = getShellCommandFlag();
      const { detached } = setDetachedSpawnOptions();
      const env = buildChildEnv({ ...params.env, FLOWTASK_RUN_ID: params.runId });

      const child = spawn(shell, [shellFlag, params.command], {
        cwd: params.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        signal: abortController.signal,
        detached,
      });

      if (child.pid !== undefined) {
        this.activeProcesses.set(`run:${params.runId}`, { pid: child.pid, runId: params.runId });
      }

      child.stdin?.end();

      let stderrCollected = "";
      let timedOut = false;
      let cancelled = false;

      const emitAndLog = (stream: "stdout" | "stderr", text: string): void => {
        const safe = this.redactor.redact(text);
        ringBuffer.push(text);

        const eventBus = getEventBus();
        eventBus.emit({
          type: "executor_output",
          runId: params.runId,
          taskId: "validation",
          executor: "validation-runner",
          stream,
          text: safe,
        });

        appendToFile(path.join(params.logsDir, "validation.log"), `[${stream}] ${safe}`).catch(
          () => {},
        );
      };

      if (child.stdout) {
        child.stdout.setEncoding("utf-8");
        let stdoutBuf = "";
        child.stdout.on("data", (data: string) => {
          stdoutBuf += data;
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() ?? "";
          for (const line of lines) {
            emitAndLog("stdout", line + "\n");
          }
        });
        child.stdout.on("end", () => {
          if (stdoutBuf) {
            emitAndLog("stdout", stdoutBuf);
          }
        });
      }

      if (child.stderr) {
        child.stderr.setEncoding("utf-8");
        let stderrBuf = "";
        child.stderr.on("data", (data: string) => {
          stderrCollected += data;
          stderrBuf += data;
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() ?? "";
          for (const line of lines) {
            emitAndLog("stderr", line + "\n");
          }
        });
        child.stderr.on("end", () => {
          if (stderrBuf) {
            emitAndLog("stderr", stderrBuf);
          }
        });
      }

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) {
          killProcessTree(child.pid, "SIGTERM");
        }
        setTimeout(() => {
          if (child.pid !== undefined && isAlive(child.pid)) {
            killProcessTree(child.pid, "SIGKILL");
          }
        }, killGraceMs);
      }, params.timeoutMs);

      const abortHandler = (): void => {
        cancelled = true;
        if (child.pid !== undefined) {
          killProcessTree(child.pid, "SIGTERM");
        }
        setTimeout(() => {
          if (child.pid !== undefined && isAlive(child.pid)) {
            killProcessTree(child.pid, "SIGKILL");
          }
        }, killGraceMs);
      };

      abortController.signal.addEventListener("abort", abortHandler, { once: true });

      child.on("close", (exitCode, signalCode) => {
        clearTimeout(timeoutHandle);
        abortController.signal.removeEventListener("abort", abortHandler);

        if (child.pid !== undefined) {
          this.activeProcesses.delete(`run:${params.runId}`);
        }

        const finishedAt = now();

        if (cancelled) {
          const output = ringBuffer.getText();
          awaitAppendLog(params.logsDir, `[${finishedAt}] CANCELLED\n`);
          resolveOnce({
            command: params.command,
            status: "cancelled",
            exitCode: exitCode ?? undefined,
            startedAt,
            finishedAt,
            output: output.slice(0, 2000),
            error: "Validation cancelled",
            ringBuffer,
            timedOut: false,
            cancelled: true,
            resourceWarnings: [],
          });
          return;
        }

        if (timedOut) {
          const output = ringBuffer.getText();
          awaitAppendLog(
            params.logsDir,
            `[${finishedAt}] TIMEOUT (exit: ${exitCode}, signal: ${signalCode})\n`,
          );
          resolveOnce({
            command: params.command,
            status: "timeout",
            exitCode: exitCode ?? undefined,
            startedAt,
            finishedAt,
            output: output.slice(0, 2000),
            error: `Validation timed out after ${params.timeoutMs}ms`,
            ringBuffer,
            timedOut: true,
            cancelled: false,
            resourceWarnings: [],
          });
          return;
        }

        const output = ringBuffer.getText();
        awaitAppendLog(
          params.logsDir,
          `[${finishedAt}] EXIT: ${exitCode}\nOUTPUT:\n${output.slice(0, 2000)}\nSTDERR:\n${stderrCollected.slice(0, 500)}\n---\n`,
        );

        const status = exitCode === 0 ? "passed" : "failed";
        resolveOnce({
          command: params.command,
          status,
          exitCode: exitCode ?? undefined,
          startedAt,
          finishedAt,
          output: output.slice(0, 2000),
          error: stderrCollected.slice(0, 2000) || undefined,
          ringBuffer,
          timedOut: false,
          cancelled: false,
          resourceWarnings: [],
        });
      });

      child.on("error", (err) => {
        clearTimeout(timeoutHandle);
        if (child.pid !== undefined) {
          this.activeProcesses.delete(`run:${params.runId}`);
        }
        const finishedAt = now();
        const isAborted = err.message.includes("aborted") || abortController.signal.aborted;
        resolveOnce({
          command: params.command,
          status: isAborted ? "cancelled" : "failed",
          startedAt,
          finishedAt,
          error: err.message,
          ringBuffer,
          timedOut: false,
          cancelled: isAborted,
          resourceWarnings: [],
        });
      });
    });
  }

  private async delayBetweenCommands(
    _concurrency: number,
    _index: number,
    _commands: string[],
  ): Promise<void> {
    // With concurrency=1 (default), commands run sequentially already.
    // With higher concurrency, we'd schedule them in parallel.
    // For now, sequential execution is the default and only mode.
    await Promise.resolve();
  }
}

function safeFrameCommand(command: string): string {
  if (!command || command.trim().length === 0) {
    throw new Error("Validation command is empty");
  }
  if (command.length > 32_768) {
    throw new Error("Validation command exceeds maximum length of 32,768 characters");
  }
  return command.trim();
}

async function awaitAppendLog(logsDir: string, text: string): Promise<void> {
  try {
    await appendToFile(path.join(logsDir, "validation.log"), text);
  } catch {
    // non-critical
  }
}
