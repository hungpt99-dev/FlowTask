import { ensureDir, appendToFile, readTextFile, readDir } from "../utils/fs.js";
import {
  getLogsDir,
  taskLogPath,
  runtimeLogPath,
  validationLogPath,
  runtimeJsonlPath,
  taskLogJsonlPath,
  validationJsonlPath,
} from "../utils/paths.js";
import { now } from "../utils/time.js";
import { SecretRedactor } from "../safety/secret-redactor.js";

const LOG_DIR_MODE = 0o700;
const LOG_FILE_MODE = 0o600;

export interface LogEntry {
  t: string;
  s: "stdout" | "stderr" | "system";
  m: string;
  l: "info" | "warn" | "error" | "debug";
  taskId?: string;
  runId?: string;
}

export class LogManager {
  private rootPath: string;
  private redactor: SecretRedactor;
  private pendingWrites = 0;
  private resolveQueue: Array<() => void> = [];

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.redactor = new SecretRedactor();
  }

  private async ensureLogDir(runId: string): Promise<void> {
    await ensureDir(getLogsDir(this.rootPath, runId), LOG_DIR_MODE);
  }

  async writeRuntime(runId: string, message: string): Promise<void> {
    await this.ensureLogDir(runId);
    const timestamp = now();
    const safeMessage = this.redactor.redact(message);
    this.pendingWrites++;
    try {
      await appendToFile(
        runtimeLogPath(this.rootPath, runId),
        `[${timestamp}] ${safeMessage}\n`,
        LOG_FILE_MODE,
      );
    } finally {
      this.pendingWrites--;
      this.checkQueue();
    }
  }

  async writeRuntimeJsonl(runId: string, entry: Omit<LogEntry, "t">): Promise<void> {
    await this.ensureLogDir(runId);
    const safeMessage = this.redactor.redact(entry.m);
    const logEntry: LogEntry = { ...entry, m: safeMessage, t: now() };
    this.pendingWrites++;
    try {
      await appendToFile(
        runtimeJsonlPath(this.rootPath, runId),
        `${JSON.stringify(logEntry)}\n`,
        LOG_FILE_MODE,
      );
    } finally {
      this.pendingWrites--;
      this.checkQueue();
    }
  }

  async writeTaskLog(runId: string, taskId: string, message: string): Promise<void> {
    await this.ensureLogDir(runId);
    const timestamp = now();
    const safeMessage = this.redactor.redact(message);
    this.pendingWrites++;
    try {
      await appendToFile(
        taskLogPath(this.rootPath, runId, taskId),
        `[${timestamp}] ${safeMessage}\n`,
        LOG_FILE_MODE,
      );
    } finally {
      this.pendingWrites--;
      this.checkQueue();
    }
  }

  async writeTaskLogJsonl(
    runId: string,
    taskId: string,
    entry: Omit<LogEntry, "t">,
  ): Promise<void> {
    await this.ensureLogDir(runId);
    const safeMessage = this.redactor.redact(entry.m);
    const logEntry: LogEntry = { ...entry, m: safeMessage, t: now(), taskId };
    this.pendingWrites++;
    try {
      await appendToFile(
        taskLogJsonlPath(this.rootPath, runId, taskId),
        `${JSON.stringify(logEntry)}\n`,
        LOG_FILE_MODE,
      );
    } finally {
      this.pendingWrites--;
      this.checkQueue();
    }
  }

  async writeValidation(runId: string, message: string): Promise<void> {
    await this.ensureLogDir(runId);
    const timestamp = now();
    const safeMessage = this.redactor.redact(message);
    this.pendingWrites++;
    try {
      await appendToFile(
        validationLogPath(this.rootPath, runId),
        `[${timestamp}] ${safeMessage}\n`,
        LOG_FILE_MODE,
      );
    } finally {
      this.pendingWrites--;
      this.checkQueue();
    }
  }

  async writeValidationJsonl(runId: string, entry: Omit<LogEntry, "t">): Promise<void> {
    await this.ensureLogDir(runId);
    const safeMessage = this.redactor.redact(entry.m);
    const logEntry: LogEntry = { ...entry, m: safeMessage, t: now() };
    this.pendingWrites++;
    try {
      await appendToFile(
        validationJsonlPath(this.rootPath, runId),
        `${JSON.stringify(logEntry)}\n`,
        LOG_FILE_MODE,
      );
    } finally {
      this.pendingWrites--;
      this.checkQueue();
    }
  }

  async flush(): Promise<void> {
    if (this.pendingWrites === 0) return;
    return new Promise<void>((resolve) => {
      this.resolveQueue.push(resolve);
    });
  }

  private checkQueue(): void {
    if (this.pendingWrites === 0) {
      const queue = [...this.resolveQueue];
      this.resolveQueue = [];
      for (const resolve of queue) {
        resolve();
      }
    }
  }

  async writeStartup(
    runId: string,
    info: {
      nodeVersion: string;
      projectMode?: string;
      configStatus: "loaded" | "defaults" | "error";
      planner?: string;
      executorCount: number;
      validationProfile?: string;
      aiProviderCount?: number;
    },
  ): Promise<void> {
    const msg = [
      `FlowTask startup`,
      `Node.js: ${info.nodeVersion}`,
      `Config: ${info.configStatus}`,
      `Mode: ${info.projectMode ?? "development"}`,
      info.planner ? `Planner: ${info.planner}` : null,
      `Executors: ${info.executorCount}`,
      info.validationProfile ? `Validation: ${info.validationProfile}` : null,
      info.aiProviderCount !== undefined ? `AI providers: ${info.aiProviderCount}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    await this.writeRuntime(runId, msg);

    await this.writeRuntimeJsonl(runId, {
      s: "system",
      m: JSON.stringify({
        event: "startup",
        nodeVersion: info.nodeVersion,
        projectMode: info.projectMode,
        configStatus: info.configStatus,
        planner: info.planner,
        executorCount: info.executorCount,
        validationProfile: info.validationProfile,
        aiProviderCount: info.aiProviderCount,
      }),
      l: "info",
      runId,
    });
  }

  async writeAiConnectivity(
    runId: string,
    results: Array<{ provider: string; ok: boolean; message: string; latencyMs?: number }>,
  ): Promise<void> {
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const summary = `AI providers: ${ok.length} ok, ${failed.length} failed (${failed.map((r) => r.provider).join(", ") || "none"})`;
    await this.writeRuntime(runId, summary);

    for (const r of results) {
      const tag = r.ok ? "OK" : "FAIL";
      const latency = r.latencyMs !== undefined ? ` (${r.latencyMs}ms)` : "";
      await this.writeRuntimeJsonl(runId, {
        s: "system",
        m: JSON.stringify({
          event: "ai_connectivity",
          provider: r.provider,
          ok: r.ok,
          message: r.message,
          latencyMs: r.latencyMs,
        }),
        l: r.ok ? "info" : "warn",
        runId,
      });
    }
  }

  async writeHealthCheck(
    runId: string,
    status: {
      overall: "healthy" | "degraded" | "failing";
      healthy: number;
      degraded: number;
      failing: number;
      total: number;
    },
  ): Promise<void> {
    const msg = `Health check: ${status.overall.toUpperCase()} (${status.healthy} healthy, ${status.degraded} degraded, ${status.failing} failing)`;
    await this.writeRuntime(runId, msg);

    await this.writeRuntimeJsonl(runId, {
      s: "system",
      m: JSON.stringify({
        event: "health_check",
        overall: status.overall,
        healthy: status.healthy,
        degraded: status.degraded,
        failing: status.failing,
        total: status.total,
      }),
      l: status.overall === "healthy" ? "info" : "warn",
      runId,
    });
  }

  async writeError(
    runId: string,
    error: { message: string; code?: string; stack?: string },
  ): Promise<void> {
    const msg = `ERROR [${error.code ?? "unknown"}]: ${error.message}`;
    await this.writeRuntime(runId, msg);

    await this.writeRuntimeJsonl(runId, {
      s: "system",
      m: JSON.stringify({
        event: "error",
        message: error.message,
        code: error.code,
        stack: error.stack,
      }),
      l: "error",
      runId,
    });
  }

  async readRuntime(runId: string): Promise<string> {
    try {
      return await readTextFile(runtimeLogPath(this.rootPath, runId));
    } catch {
      return "";
    }
  }

  async readValidation(runId: string): Promise<string> {
    try {
      return await readTextFile(validationLogPath(this.rootPath, runId));
    } catch {
      return "";
    }
  }

  async readTaskLog(runId: string, taskId: string): Promise<string> {
    try {
      return await readTextFile(taskLogPath(this.rootPath, runId, taskId));
    } catch {
      return "";
    }
  }

  async listLogFiles(runId: string): Promise<string[]> {
    const dir = getLogsDir(this.rootPath, runId);
    const files = await readDir(dir);
    return files.filter((f) => f.endsWith(".log"));
  }
}
