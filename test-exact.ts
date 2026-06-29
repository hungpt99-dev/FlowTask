import { type Step } from "./src/schemas/step.schema.js";
function saveSteps(steps: Step[]): void {
  console.log(steps.length);
}
// Exact pattern from the test:
saveSteps([
  {
    id: "step_order_001",
    taskId: "task_order_001",
    runId: "run_001",
    title: "First step",
    type: "shell",
    command: "echo first",
    status: "done",
    requiresApproval: false,
    order: 0,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  },
]);
export {};
