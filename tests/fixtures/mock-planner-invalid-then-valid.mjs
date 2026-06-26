#!/usr/bin/env node

const stateFile = process.env.MOCK_PLANNER_STATE_FILE;
let state = { attempts: 0 };

if (stateFile) {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(stateFile, "utf-8").catch(() => "{}");
    state = JSON.parse(content);
  } catch {
    state = { attempts: 0 };
  }
}

state.attempts = (state.attempts ?? 0) + 1;

if (stateFile) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(stateFile, JSON.stringify(state), "utf-8");
}

if (state.attempts === 1) {
  console.log("This is not valid JSON. It is just some prose text.");
  process.exit(0);
}

const output = {
  title: "Plan from mock AI (after repair)",
  summary: "Mock AI generated plan on second attempt",
  tasks: [
    {
      title: "Task after repair",
      description: "Task from repaired output",
      executor: "shell",
      acceptanceCriteria: ["Repair worked"],
    },
  ],
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
