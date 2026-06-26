#!/usr/bin/env node

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("[mock-ai-stream] Reading README.md");
  await delay(50);
  console.log("[mock-ai-stream] Updating README.md");
  await delay(50);
  console.error("[mock-ai-stream][stderr] warning: sample warning");
  await delay(50);
  console.log("[mock-ai-stream] Done");
}

main().then(() => process.exit(0));
