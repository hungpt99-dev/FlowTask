import { ensureDir, appendToFile, readTextFile, readDir } from "../utils/fs.js";
import { getLogsDir, taskLogPath, runtimeLogPath, validationLogPath } from "../utils/paths.js";
import { now } from "../utils/time.js";
import { SecretRedactor } from "../safety/secret-redactor.js";

const LOG_DIR_MODE = 0o700;
const LOG_FILE_MODE = 0o600;

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
