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
  title: "Plan from mock AI (fenced)",
  summary: "Mock AI generated plan in code fence",
  tasks: [
    {
      title: "Task 1",
      description: "First task from mock AI",
      executor: "shell",
      acceptanceCriteria: ["Task 1 completed"],
      validation: { commands: ["echo done"] },
    },
  ],
};

console.log("Here is the task plan:");
console.log("```json");
process.stdout.write(JSON.stringify(output));
console.log("\n```");
console.log("End of plan.");
process.exit(0);
