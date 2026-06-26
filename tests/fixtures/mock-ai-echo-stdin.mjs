#!/usr/bin/env node

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = Buffer.concat(chunks).toString("utf-8");

console.log(`[mock-ai-echo] Received ${input.length} chars on stdin`);
console.log(`[mock-ai-echo] Content preview: ${input.slice(0, 100)}...`);
process.exit(0);
