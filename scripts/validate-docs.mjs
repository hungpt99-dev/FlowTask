#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "docs");

const REQUIRED_DOCS = [
  "AI_AGENT_RULES.md",
  "CODE_QUALITY.md",
  "DEVELOPMENT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "GIT_WORKFLOW.md",
  "CODEGRAPH.md",
  "IDEA.MD",
  "TECHNICAL.MD",
];

async function main() {
  let allValid = true;

  const existingFiles = new Set(readdirSync(DOCS_DIR));

  for (const doc of REQUIRED_DOCS) {
    if (!existingFiles.has(doc)) {
      console.error(`Missing required doc: ${doc}`);
      allValid = false;
      continue;
    }
    const docPath = join(DOCS_DIR, doc);
    const stats = statSync(docPath);
    if (stats.size === 0) {
      console.error(`Empty doc file: ${doc}`);
      allValid = false;
    }
  }

  if (allValid) {
    console.log("All required docs exist and are non-empty.");
    process.exit(0);
  } else {
    console.error("Some docs are missing or empty.");
    process.exit(1);
  }
}

main();
