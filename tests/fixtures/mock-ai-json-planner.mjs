#!/usr/bin/env node

const input = await (async () => {
  if (process.argv.length > 2) {
    return process.argv.slice(2).join(" ");
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
})();

const output = {
  title: "Plan from mock AI",
  summary: "Mock AI generated plan",
  tasks: [
    {
      title: "Task 1",
      description: "First task from mock AI",
      executor: "shell",
      acceptanceCriteria: ["Task 1 completed"],
      validation: { commands: ["echo done"] },
    },
    {
      title: "Task 2",
      description: "Second task from mock AI",
      executor: "shell",
      dependsOn: ["Task 1"],
      acceptanceCriteria: ["Task 2 completed"],
      validation: { commands: ["echo done"] },
    },
  ],
};

console.log(JSON.stringify(output, null, 2));
process.exit(0);
