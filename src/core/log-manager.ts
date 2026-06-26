import { ensureDir, appendToFile, readTextFile, readDir } from "../utils/fs.js";
import { getLogsDir, taskLogPath, runtimeLogPath, validationLogPath } from "../utils/paths.js";
import { now } from "../utils/time.js";
import { SecretRedactor } from "../safety/secret-redactor.js";

export class LogManager {
  private rootPath: string;
  private redactor: SecretRedactor;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.redactor = new SecretRedactor();
  }

  private async ensureLogDir(runId: string): Promise<void> {
    await ensureDir(getLogsDir(this.rootPath, runId));
  }

  async writeRuntime(runId: string, message: string): Promise<void> {
    await this.ensureLogDir(runId);
    const timestamp = now();
    const safeMessage = this.redactor.redact(message);
    await appendToFile(runtimeLogPath(this.rootPath, runId), `[${timestamp}] ${safeMessage}\n`);
  }

  async writeTaskLog(runId: string, taskId: string, message: string): Promise<void> {
    await this.ensureLogDir(runId);
    const timestamp = now();
    const safeMessage = this.redactor.redact(message);
    await appendToFile(
      taskLogPath(this.rootPath, runId, taskId),
      `[${timestamp}] ${safeMessage}\n`,
    );
  }

  async writeValidation(runId: string, message: string): Promise<void> {
    await this.ensureLogDir(runId);
    const timestamp = now();
    const safeMessage = this.redactor.redact(message);
    await appendToFile(validationLogPath(this.rootPath, runId), `[${timestamp}] ${safeMessage}\n`);
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
