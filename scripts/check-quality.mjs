#!/usr/bin/env node

import { execSync } from "node:child_process";

const CHECKS = [
  { name: "TypeCheck", command: "pnpm typecheck" },
  { name: "Lint", command: "pnpm lint" },
  { name: "Format", command: "pnpm format:check" },
  { name: "Tests", command: "pnpm test" },
];

async function main() {
  let allPassed = true;
  for (const check of CHECKS) {
    process.stdout.write(`Running ${check.name}... `);
    try {
      execSync(check.command, { stdio: "pipe", encoding: "utf-8" });
      console.log("PASSED");
    } catch (err) {
      console.log("FAILED");
      if (err instanceof Error) {
        console.error(err.message);
      }
      allPassed = false;
    }
  }
  process.exit(allPassed ? 0 : 1);
}

main();
