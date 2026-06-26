#!/usr/bin/env node

import { execSync } from "node:child_process";

async function main() {
  console.log("FlowTask Doctor\n");

  const checks = [
    {
      name: "Node.js version",
      check: () => {
        const v = process.version;
        const major = parseInt(v.slice(1), 10);
        return { ok: major >= 22, message: v };
      },
    },
    {
      name: "Package manager (pnpm)",
      check: () => {
        try {
          const out = execSync("pnpm --version", { encoding: "utf-8" }).trim();
          return { ok: true, message: out };
        } catch {
          return { ok: false, message: "not found" };
        }
      },
    },
    {
      name: "Git available",
      check: () => {
        try {
          const out = execSync("git --version", { encoding: "utf-8" }).trim();
          return { ok: true, message: out };
        } catch {
          return { ok: false, message: "not found" };
        }
      },
    },
    {
      name: "TypeScript installed",
      check: () => {
        try {
          const out = execSync("pnpm tsc --version", { encoding: "utf-8" }).trim();
          return { ok: true, message: out };
        } catch {
          return { ok: false, message: "not found" };
        }
      },
    },
  ];

  let allOk = true;
  for (const check of checks) {
    const result = check.check();
    const icon = result.ok ? "\u2714" : "\u2718";
    console.log(`  ${icon} ${check.name}: ${result.message}`);
    if (!result.ok) allOk = false;
  }

  console.log(allOk ? "\nAll checks passed." : "\nSome checks failed.");
  process.exit(allOk ? 0 : 1);
}

main();
