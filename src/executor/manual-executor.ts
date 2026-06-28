import { type Executor, type ExecutorInput, type ExecutorResult } from "./executor.js";
import { now } from "../utils/time.js";

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export class ManualExecutor implements Executor {
  name = "manual";

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const startedAt = now();

    if (!process.stdin.isTTY) {
      console.log("\n[manual-executor] Non-TTY mode detected, marking task as done.");
      return {
        status: "done",
        startedAt,
        finishedAt: now(),
      };
    }

    console.log(`\n=== Manual Task: ${input.task.title} ===`);
    if (input.task.description) {
      console.log(`Description: ${input.task.description}`);
    }
    if (input.task.outputPlan && input.task.outputPlan.length > 0) {
      console.log("\nExpected Outputs:");
      for (const output of input.task.outputPlan) {
        const actionLabel =
          output.action === "create" ? "Create" : output.action === "modify" ? "Modify" : "Delete";
        console.log(`  - ${actionLabel} ${output.target}`);
        if (output.description) {
          console.log(`    ${output.description}`);
        }
        console.log(`    Validation: ${output.validationMethod}`);
      }
      console.log("");
    }
    console.log(`Context: ${input.contextPackPath}\n`);
    console.log("Press Enter when done, or type 'skip' to skip this task.");

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        console.log("\n[manual-executor] Timed out waiting for input.");
        resolve({
          status: "timeout",
          error: "Manual task timed out waiting for user input",
          startedAt,
          finishedAt: now(),
        });
      }, DEFAULT_TIMEOUT_MS);

      const onData = (data: Buffer): void => {
        clearTimeout(timeoutHandle);
        const inputStr = data.toString().trim();
        if (inputStr.toLowerCase() === "skip") {
          resolve({
            status: "skipped",
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
      };

      process.stdin.once("data", onData);

      if (input.signal) {
        input.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeoutHandle);
            process.stdin.removeListener("data", onData);
            resolve({
              status: "cancelled",
              error: "Manual task was cancelled",
              startedAt,
              finishedAt: now(),
            });
          },
          { once: true },
        );
      }
    });
  }
}
