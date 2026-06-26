import type { Task } from "../../schemas/task.schema.js";
import { generateTaskId } from "../../utils/ids.js";
import { now } from "../../utils/time.js";

export function generateBugfixTasks(runId: string, _prompt: string): Task[] {
  const timestamp = now();
  return [
    {
      id: generateTaskId(),
      runId,
      title: "Reproduce bug",
      description: "Reproduce the reported bug and capture error details.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Bug is reproduced"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateTaskId(),
      runId,
      title: "Identify root cause",
      description: "Analyze code to find the root cause of the bug.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Root cause is identified"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateTaskId(),
      runId,
      title: "Implement fix",
      description: "Write the fix for the identified root cause.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Fix is implemented"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateTaskId(),
      runId,
      title: "Verify fix",
      description: "Verify the fix resolves the bug and existing tests pass.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Bug is fixed and tests pass"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}
