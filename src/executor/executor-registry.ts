import type { Executor } from "./executor.js";
import { ShellExecutor } from "./shell-executor.js";
import { CommandExecutor } from "./command-executor.js";
import { ManualExecutor } from "./manual-executor.js";

export class ExecutorRegistry {
  private executors: Map<string, Executor> = new Map();

  constructor() {
    this.register("shell", new ShellExecutor());
    this.register("manual", new ManualExecutor());
  }

  register(name: string, executor: Executor): void {
    this.executors.set(name, executor);
  }

  get(name: string): Executor | undefined {
    return this.executors.get(name);
  }

  has(name: string): boolean {
    return this.executors.has(name);
  }

  registerCommandExecutor(name: string, command: string): void {
    this.executors.set(name, new CommandExecutor(command));
  }

  list(): string[] {
    return Array.from(this.executors.keys());
  }
}
