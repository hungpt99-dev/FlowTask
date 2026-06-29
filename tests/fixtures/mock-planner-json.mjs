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

const output = {
  title: "Plan from mock AI",
  summary: "Mock AI generated plan",
  tasks: [
    {
      title: "Review current README and docs",
      description: "Read README and relevant docs to understand current state.",
      executor: "shell",
      dependsOn: [],
      riskLevel: "safe",
      acceptanceCriteria: ["Current README has been reviewed", "Relevant docs have been reviewed"],
      validation: {
        requiredArtifacts: [],
      },
    },
    {
      title: "Update README",
      description: "Update README to match current implementation.",
      executor: "opencode",
      dependsOn: ["Review current README and docs"],
      riskLevel: "safe",
      acceptanceCriteria: [
        "README is updated",
        "README matches actual CLI commands",
        "README includes known limitations",
      ],
      validation: {
        requireGitDiff: true,
      },
    },
  ],
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
