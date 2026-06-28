import { spawn } from "node:child_process";
import { getShell, getShellCommandFlag } from "../utils/shell.js";

export interface HookConfig {
  beforeRun?: string[];
  afterRun?: string[];
  beforeTask?: string[];
  afterTask?: string[];
  beforeRetry?: string[];
  afterRetry?: string[];
  onFailure?: string[];
  failOnError?: boolean;
}

export interface HookContext {
  runId: string;
  taskId?: string;
  taskTitle?: string;
  retryCount?: number;
  maxRetries?: number;
  success?: boolean;
  error?: string;
}

export interface HookResult {
  command: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export class HookManager {
  private config: HookConfig;
  private rootPath: string;

  constructor(rootPath: string, config?: HookConfig) {
    this.rootPath = rootPath;
    this.config = config ?? {};
  }

  async runBeforeRun(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeRun ?? [], context);
  }

  async runAfterRun(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterRun ?? [], context);
  }

  async runBeforeTask(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeTask ?? [], context);
  }

  async runAfterTask(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterTask ?? [], context);
  }

  async runBeforeRetry(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeRetry ?? [], context);
  }

  async runAfterRetry(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterRetry ?? [], context);
  }

  async runOnFailure(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onFailure ?? [], context);
  }

  private async executeHooks(commands: string[], context: HookContext): Promise<HookResult[]> {
    if (commands.length === 0) return [];

    const results: HookResult[] = [];

    for (const command of commands) {
      const result = await this.executeCommand(command, context);
      results.push(result);
      if (!result.success && this.config.failOnError) {
        throw new Error(`Hook failed: ${command}\n${result.stderr}`);
      }
    }

    return results;
  }

  private executeCommand(command: string, context: HookContext): Promise<HookResult> {
    return new Promise((resolve) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOOK_RUN_ID: context.runId,
        HOOK_ROOT_PATH: this.rootPath,
      };

      if (context.taskId) env.HOOK_TASK_ID = context.taskId;
      if (context.taskTitle) env.HOOK_TASK_TITLE = context.taskTitle;
      if (context.retryCount !== undefined) env.HOOK_RETRY_COUNT = String(context.retryCount);
      if (context.maxRetries !== undefined) env.HOOK_MAX_RETRIES = String(context.maxRetries);
      if (context.success !== undefined) env.HOOK_SUCCESS = String(context.success);
      if (context.error) env.HOOK_ERROR = context.error;

      const shell = getShell();
      const flag = getShellCommandFlag();
      const child = spawn(shell, [flag, command], {
        cwd: this.rootPath,
        env: env as Record<string, string>,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (exitCode) => {
        resolve({
          command,
          success: exitCode === 0,
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      child.on("error", (err) => {
        resolve({
          command,
          success: false,
          exitCode: null,
          stdout: "",
          stderr: err.message,
        });
      });
    });
  }
}
