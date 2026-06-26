import type { Executor, ExecutorInput, ExecutorResult } from "./executor.js";
import { CommandExecutor } from "./command-executor.js";
import { ManualExecutor } from "./manual-executor.js";
import type { ExecutorEntry } from "../schemas/config.schema.js";
import type { ProcessManager } from "../core/process-manager.js";

export class ExecutorRegistry {
  private executors: Map<string, Executor> = new Map();
  private executorConfigs: Map<string, ExecutorEntry> = new Map();

  constructor() {
    this.register("shell", {
      name: "shell",
      execute: async (_input: ExecutorInput): Promise<ExecutorResult> => {
        const { ShellExecutor } = await import("./shell-executor.js");
        return new ShellExecutor().execute(_input);
      },
    });
    this.register("manual", new ManualExecutor());
  }

  setProcessManager(_pm: ProcessManager): void {
    for (const [name] of this.executorConfigs) {
      const executor = this.executors.get(name);
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
}
