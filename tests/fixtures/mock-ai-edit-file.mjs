#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const cwd = process.cwd();
const outPath = path.join(cwd, "mock-output.txt");
fs.writeFileSync(
  outPath,
  `Mock AI output generated at ${new Date().toISOString()}\n\n${input.slice(0, 500)}`,
);
console.log(`[mock-ai-edit-file] Created ${outPath}`);
process.exit(0);
