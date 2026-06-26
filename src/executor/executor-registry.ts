import type { Executor, ExecutorInput, ExecutorResult } from "./executor.js";
import { CommandExecutor } from "./command-executor.js";
import { ManualExecutor } from "./manual-executor.js";
import type { ExecutorEntry } from "../schemas/config.schema.js";
import type { ProcessManager } from "../core/process-manager.js";
import type { LogManager } from "../core/log-manager.js";
import { mergeExecutorConfigs } from "./executor-presets.js";

export class ExecutorRegistry {
  private executors: Map<string, Executor> = new Map();
  private executorConfigs: Map<string, ExecutorEntry> = new Map();
  private logManager?: LogManager;
  private mergedExecutors: Record<string, ExecutorEntry>;

  constructor(config?: { executors?: Record<string, ExecutorEntry> }) {
    this.mergedExecutors = mergeExecutorConfigs(config?.executors);

    this.register("shell", {
      name: "shell",
      execute: async (_input: ExecutorInput): Promise<ExecutorResult> => {
        const { ShellExecutor } = await import("./shell-executor.js");
        return new ShellExecutor().execute(_input);
      },
    });
    this.register("manual", new ManualExecutor());

    for (const [name, entry] of Object.entries(this.mergedExecutors)) {
      if (name === "shell" || name === "manual") continue;
      this.registerCommandExecutor(name, entry);
    }
  }

  setLogManager(lm: LogManager): void {
    this.logManager = lm;
    for (const [, executor] of this.executors) {
      if (executor instanceof CommandExecutor) {
        executor.setLogManager(lm);
      }
    }
  }

  setProcessManager(_pm: ProcessManager): void {
    for (const [, executor] of this.executors) {
      if (executor instanceof CommandExecutor) {
        executor.setProcessManager(_pm);
      }
    }
  }

  register(name: string, executor: Executor): void {
    this.executors.set(name, executor);
  }

  registerCommandExecutor(name: string, config: ExecutorEntry): void {
    const executor = new CommandExecutor(config);
    if (this.logManager) {
      executor.setLogManager(this.logManager);
    }
    this.executors.set(name, executor);
    this.executorConfigs.set(name, config);
  }

  get(name: string): Executor | undefined {
    return this.executors.get(name);
  }

  has(name: string): boolean {
    return this.executors.has(name);
  }

  getConfig(name: string): ExecutorEntry | undefined {
    return this.executorConfigs.get(name);
  }

  list(): string[] {
    return Array.from(this.executors.keys());
  }

  listPresets(): string[] {
    return Object.keys(this.mergedExecutors);
  }
}
