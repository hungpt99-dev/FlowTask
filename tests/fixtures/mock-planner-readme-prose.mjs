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

console.log("# README for FlowTask");
console.log("");
console.log("FlowTask is a local-first AI task runtime CLI.");
console.log("");
console.log("## Installation");
console.log("");
console.log("```bash");
console.log("pnpm install");
console.log("```");
console.log("");
console.log("## Usage");
console.log("");
console.log("```bash");
console.log('flowtask run "Do something"');
console.log("```");
console.log("");
console.log("FlowTask turns prompts into visible, validated, resumable AI task flows.");
console.log("");
console.log("## License");
console.log("");
console.log("MIT");
process.exit(0);
