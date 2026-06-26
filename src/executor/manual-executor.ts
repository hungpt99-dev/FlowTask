import { type Executor, type ExecutorInput, type ExecutorResult } from "./executor.js";
import { now } from "../utils/time.js";

export class ManualExecutor implements Executor {
  name = "manual";

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const startedAt = now();
    console.log(`\n=== Manual Task: ${input.task.title} ===`);
    if (input.task.description) {
      console.log(`Description: ${input.task.description}`);
    }
    console.log(`Context: ${input.contextPackPath}\n`);
    console.log("Press Enter when done, or type 'skip' to skip this task.");

    return new Promise((resolve) => {
      process.stdin.once("data", (data: Buffer) => {
        const inputStr = data.toString().trim();
        if (inputStr.toLowerCase() === "skip") {
          resolve({
            status: "failed",
            error: "Skipped by user",
            startedAt,
            finishedAt: now(),
          });
        } else {
          resolve({
            status: "done",
            startedAt,
            finishedAt: now(),
          });
        }
      });
    });
  }
}
