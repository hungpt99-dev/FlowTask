import type { Executor, ExecutorInput, ExecutorResult } from "./executor.js";
import { CommandExecutor } from "./command-executor.js";
import { ManualExecutor } from "./manual-executor.js";
import type { ExecutorEntry } from "../schemas/config.schema.js";

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

  register(name: string, executor: Executor): void {
    this.executors.set(name, executor);
  }

  registerCommandExecutor(name: string, config: ExecutorEntry): void {
    this.executors.set(name, new CommandExecutor(config));
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
