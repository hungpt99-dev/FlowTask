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

console.log(`[mock-ai-slow] Starting slow task`);
console.log(`[mock-ai-slow] Input length: ${input.length} chars`);

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 200));
  console.log(`[mock-ai-slow] Heartbeat ${i + 1}/30`);
}

console.log(`[mock-ai-slow] Done`);
process.exit(0);
