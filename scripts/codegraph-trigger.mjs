#!/usr/bin/env node

import { execSync } from "node:child_process";

const COMMANDS = ["codegraph", "codegraph-cli"];

async function main() {
  for (const cmd of COMMANDS) {
    try {
      execSync(`which ${cmd}`, { stdio: "ignore" });
      try {
        execSync(`${cmd} explore --help`, { stdio: "inherit" });
      } catch {
        execSync(`${cmd} --help`, { stdio: "inherit" });
      }
      console.log(`Codegraph trigger completed using: ${cmd}`);
      process.exit(0);
    } catch {
      continue;
    }
  }

  console.warn("Codegraph not found. Skipping codegraph trigger.");
  process.exit(0);
}

main();
