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

console.error(`[mock-ai-fail] Simulating failure`);
console.error(`[mock-ai-fail] Input length: ${input.length} chars`);
process.exit(1);
