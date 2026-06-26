import type { Task } from "../../schemas/task.schema.js";
import { generateTaskId } from "../../utils/ids.js";
import { now } from "../../utils/time.js";

export function generateDocsTasks(runId: string, _prompt: string): Task[] {
  const timestamp = now();
  return [
    {
      id: generateTaskId(),
      runId,
      title: "Review existing documentation",
      description: "Review existing docs to understand what needs to be updated.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Existing docs are reviewed"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateTaskId(),
      runId,
      title: "Gather technical details",
      description: "Collect technical details needed for documentation.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Technical details are gathered"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateTaskId(),
      runId,
      title: "Write documentation",
      description: "Create or update documentation files.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Documentation is written"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: generateTaskId(),
      runId,
      title: "Review and finalize",
      description: "Review documentation for accuracy and completeness.",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: ["Documentation is reviewed and finalized"],
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}
