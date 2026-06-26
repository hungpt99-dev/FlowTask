import type { UiEvent } from "../event-bus.js";
import type { EventBus } from "../event-bus.js";

export class PlainRenderer {
  subscribe(eventBus: EventBus): () => void {
    return eventBus.subscribe((event: UiEvent) => {
      this.render(event);
    });
  }

  render(event: UiEvent): void {
    if (event.type === "executor_output") {
      process.stdout.write(`[${event.taskId}][${event.executor}][${event.stream}] ${event.text}\n`);
    } else if (event.type === "executor_started") {
      process.stdout.write(`[${event.taskId}][${event.executor}] started\n`);
    } else if (event.type === "executor_exited") {
      process.stdout.write(
        `[${event.taskId}][${event.executor}] exited with code ${event.exitCode}\n`,
      );
    } else if (event.type === "executor_failed") {
      process.stdout.write(`[${event.taskId}][${event.executor}] failed: ${event.reason}\n`);
    } else if (event.type === "task_completed") {
      process.stdout.write(`✓ ${event.title}\n`);
    } else if (event.type === "task_failed") {
      process.stdout.write(`✗ ${event.title} — ${event.reason}\n`);
    } else if (event.type === "run_completed") {
      process.stdout.write(event.success ? "✓ Run completed\n" : "✗ Run failed\n");
    } else if (event.type === "validation_passed") {
      process.stdout.write("✓ Validation passed\n");
    } else if (event.type === "validation_failed") {
      process.stdout.write(`✗ Validation failed: ${event.reason}\n`);
    } else if (event.type === "info") {
      process.stdout.write(`${event.message}\n`);
    }
  }
}
