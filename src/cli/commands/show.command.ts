import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { EventStore } from "../../core/event-store.js";
import { StepManager } from "../../core/step-manager.js";
import { ArtifactManager } from "../../core/artifact-manager.js";
import { DatabaseManager } from "../../core/database-manager.js";
import picocolors from "picocolors";
import { coloredSymbol, coloredStatus } from "../../ui/formatters/status-format.js";
import { formatTimeAgo, formatDuration } from "../../ui/formatters/duration-format.js";
import { dbPath } from "../../utils/paths.js";

export async function showCommand(
  runId: string,
  options: { json?: boolean; full?: boolean },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(runId);

  if (!run) {
    console.log(picocolors.red(`Run not found: ${runId}`));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  const tasks = await runManager.loadTasks(runId);
  const timeline = await runManager.getRunTimeline(runId);
  const errors = await runManager.getRunErrors(runId);
  const approvals = await runManager.getRunApprovals(runId);
  const fileChanges = await runManager.getRunFileChanges(runId);
  const costUsage = await runManager.getRunCostUsage(runId);
  const tokenUsage = await runManager.getRunTokenUsage(runId);

  const eventStore = new EventStore(rootPath);
  const events = await eventStore.readRunEvents(runId);
  const timelineSummary = await eventStore.getTimelineSummary(runId);
  const auditLog = await eventStore.getAuditLog(runId, { limit: options.full ? 100 : 10 });
  const auditSummary = await eventStore.getAuditSummary(runId);

  // artifacts summary
  const db = await DatabaseManager.create(dbPath(rootPath));
  const artifactManager = new ArtifactManager();
  artifactManager.setDatabase(db);
  const artifactSummary = await artifactManager.getArtifactsSummary(rootPath, runId);
  db.close();

  // step summary
  const stepManager = new StepManager(rootPath);
  const allStepsByTask = await stepManager.loadAllSteps(runId);
  const allSteps = Object.values(allStepsByTask).flat();
  const stepCounts: Record<string, number> = {};
  for (const s of allSteps) {
    stepCounts[s.status] = (stepCounts[s.status] ?? 0) + 1;
  }

  // show header
  console.log(picocolors.cyan(`\n  Run ${picocolors.bold(run.title)}`));
  console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
  console.log(`  ${picocolors.dim("Run ID:")}       ${run.runId}`);
  console.log(
    `  ${picocolors.dim("Status:")}       ${coloredSymbol(run.status)} ${coloredStatus(run.status)}`,
  );
  if (run.mode) console.log(`  ${picocolors.dim("Mode:")}         ${run.mode}`);
  if (run.userGoal && run.userGoal !== run.title) {
    console.log(`  ${picocolors.dim("Goal:")}         ${run.userGoal}`);
  }
  console.log(
    `  ${picocolors.dim("Created:")}      ${new Date(run.createdAt).toLocaleString()} (${formatTimeAgo(run.createdAt)})`,
  );
  if (run.startedAt) {
    console.log(`  ${picocolors.dim("Started:")}      ${new Date(run.startedAt).toLocaleString()}`);
  }
  if (run.finishedAt) {
    console.log(
      `  ${picocolors.dim("Finished:")}     ${new Date(run.finishedAt).toLocaleString()}`,
    );
  }
  if (run.durationMs != null) {
    console.log(`  ${picocolors.dim("Duration:")}     ${formatDuration(run.durationMs)}`);
  }
  console.log(
    `  ${picocolors.dim("Progress:")}     ${run.completedTaskCount}/${run.taskCount} tasks`,
  );

  // Cost & Usage
  if (costUsage || tokenUsage) {
    console.log(picocolors.cyan(`\n  Cost & Usage`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    if (costUsage) {
      console.log(
        `  ${picocolors.dim("Total cost:")}   ${costUsage.totalCost.toFixed(6)} ${costUsage.currency}`,
      );
    }
    if (tokenUsage) {
      console.log(
        `  ${picocolors.dim("Tokens:")}       ${tokenUsage.totalTokens.toLocaleString()} (${tokenUsage.inputTokens.toLocaleString()} in / ${tokenUsage.outputTokens.toLocaleString()} out)`,
      );
    }
  }

  // Artifacts Summary
  if (artifactSummary.total > 0) {
    console.log(picocolors.cyan(`\n  Artifacts (${artifactSummary.total})`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    console.log(
      `  ${picocolors.dim("Expected:")}   ${artifactSummary.expected}  ${picocolors.dim("Unexpected:")} ${artifactSummary.unexpected}`,
    );
    const topTypes = Object.entries(artifactSummary.byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (topTypes.length > 0) {
      console.log(
        `  ${picocolors.dim("By type:")}     ${topTypes.map(([t, c]) => `${t}: ${c}`).join(", ")}`,
      );
    }
    const topValidation = Object.entries(artifactSummary.byValidation)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topValidation.length > 0) {
      console.log(
        `  ${picocolors.dim("Validation:")}  ${topValidation.map(([t, c]) => `${t}: ${c}`).join(", ")}`,
      );
    }
  }

  // Tasks
  console.log(picocolors.cyan(`\n  Tasks (${tasks.length})`));
  console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
  if (tasks.length === 0) {
    console.log(`  ${picocolors.dim("No tasks")}`);
  } else {
    const pending = tasks.filter((t) => t.status === "pending").length;
    const running = tasks.filter((t) => t.status === "running").length;
    const done = tasks.filter((t) => t.status === "done").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const skipped = tasks.filter((t) => t.status === "skipped").length;
    const cancelled = tasks.filter((t) => t.status === "cancelled").length;
    const parts: string[] = [];
    if (done > 0) parts.push(picocolors.green(`${done} done`));
    if (failed > 0) parts.push(picocolors.red(`${failed} failed`));
    if (running > 0) parts.push(picocolors.cyan(`${running} running`));
    if (pending > 0) parts.push(picocolors.dim(`${pending} pending`));
    if (skipped > 0) parts.push(picocolors.yellow(`${skipped} skipped`));
    if (cancelled > 0) parts.push(picocolors.yellow(`${cancelled} cancelled`));
    if (parts.length > 0) console.log(`  ${parts.join(", ")}`);

    const maxShow = options.full ? tasks.length : 10;
    for (let i = 0; i < Math.min(tasks.length, maxShow); i++) {
      const t = tasks[i]!;
      const icon = coloredSymbol(t.status);
      const retries =
        t.retryCount && t.retryCount > 0 ? picocolors.yellow(` [retried ${t.retryCount}x]`) : "";
      console.log(`  ${icon} ${t.title}${retries}`);
      console.log(`      ${picocolors.dim(`ID: ${t.id} \u00B7 ${t.executor}`)}`);
    }
    if (!options.full && tasks.length > 10) {
      console.log(
        `  ${picocolors.dim(`... and ${tasks.length - 10} more (use --full to show all)`)}`,
      );
    }
  }

  // Steps Summary
  if (allSteps.length > 0) {
    console.log(picocolors.cyan(`\n  Steps (${allSteps.length})`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    const stepParts: string[] = [];
    for (const [status, count] of Object.entries(stepCounts).sort()) {
      stepParts.push(`${status}: ${count}`);
    }
    console.log(`  ${stepParts.join(" · ")}`);
  }

  // Timeline
  if (timeline.length > 0) {
    console.log(picocolors.cyan(`\n  Timeline (${timeline.length} events)`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    const show = options.full ? timeline : timeline.slice(-10);
    for (const evt of show) {
      const time = picocolors.dim(new Date(evt.timestamp).toLocaleTimeString());
      const msg = evt.message ? ` \u2014 ${picocolors.dim(evt.message)}` : "";
      console.log(`  ${time} ${evt.type}${msg}`);
    }
    if (!options.full && timeline.length > 10) {
      console.log(
        `  ${picocolors.dim(`... ${timeline.length - 10} more (use --full to show all)`)}`,
      );
    }
  }

  // Errors
  if (errors.length > 0) {
    console.log(picocolors.red(`\n  Errors (${errors.length})`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    for (const err of errors) {
      console.log(`  ${picocolors.red("\u2717")} ${err.message}`);
      if (err.suggestedFix) {
        console.log(`      ${picocolors.dim(`Fix: ${err.suggestedFix}`)}`);
      }
    }
  }

  // Approvals
  if (approvals.length > 0) {
    console.log(picocolors.cyan(`\n  Approvals (${approvals.length})`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    for (const a of approvals) {
      const icon =
        a.status === "approved"
          ? picocolors.green("\u2713")
          : a.status === "rejected"
            ? picocolors.red("\u2717")
            : picocolors.yellow("?");
      console.log(`  ${icon} ${a.type}: ${a.status}${a.reason ? ` (${a.reason})` : ""}`);
    }
  }

  // File Changes
  if (fileChanges.length > 0) {
    console.log(picocolors.cyan(`\n  File Changes (${fileChanges.length})`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    const maxShow = options.full ? fileChanges.length : 20;
    for (const fc of fileChanges.slice(0, maxShow)) {
      const icon =
        fc.type === "created"
          ? picocolors.green("+")
          : fc.type === "deleted"
            ? picocolors.red("-")
            : fc.type === "renamed"
              ? picocolors.yellow("\u2192")
              : picocolors.blue("~");
      const expected = fc.expected === false ? picocolors.yellow(" [unexpected]") : "";
      console.log(`  ${icon} ${fc.path}${fc.diffStat ? ` (${fc.diffStat})` : ""}${expected}`);
    }
    if (!options.full && fileChanges.length > 20) {
      console.log(
        `  ${picocolors.dim(`... ${fileChanges.length - 20} more (use --full to show all)`)}`,
      );
    }
  }

  // Events
  if (events.length > 0) {
    console.log(picocolors.cyan(`\n  Events (${events.length})`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    const show = options.full ? events : events.slice(-8);
    for (const event of show) {
      const time = picocolors.dim(new Date(event.time).toLocaleTimeString());
      const msg = event.message ? ` \u2014 ${picocolors.dim(event.message)}` : "";
      console.log(`  ${time} ${event.type}${msg}`);
    }
    if (!options.full && events.length > 8) {
      console.log(`  ${picocolors.dim(`... ${events.length - 8} more (use --full to show all)`)}`);
    }
  }

  // Timeline Summary
  if (timelineSummary.total > 0) {
    console.log(picocolors.cyan(`\n  Timeline Summary (${timelineSummary.total} total)`));
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    const types = Object.entries(timelineSummary.byType).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of types.slice(0, 10)) {
      console.log(`  ${picocolors.dim(type.padEnd(25))} ${count}`);
    }
    if (timelineSummary.lastEvent) {
      console.log(
        `  ${picocolors.dim("Last event:")}     ${timelineSummary.lastEvent.type} at ${new Date(timelineSummary.lastEvent.timestamp).toLocaleTimeString()}`,
      );
    }
  }

  // Audit Log
  if (auditLog.length > 0) {
    console.log(
      picocolors.cyan(
        `\n  Audit Log (${auditSummary.total} total, ${auditSummary.errors} errors, ${auditSummary.warnings} warnings)`,
      ),
    );
    console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
    for (const entry of auditLog) {
      const time = picocolors.dim(new Date(entry.time).toLocaleTimeString());
      const severity =
        entry.severity === "error"
          ? picocolors.red("ERR")
          : entry.severity === "warn"
            ? picocolors.yellow("WRN")
            : picocolors.dim("INF");
      const msg = entry.message ? ` \u2014 ${entry.message}` : "";
      console.log(`  ${time} ${severity} ${entry.action}${msg}`);
    }
    if (!options.full && auditSummary.total > 10) {
      console.log(
        `  ${picocolors.dim(`... ${auditSummary.total - 10} more (use --full to show all)`)}`,
      );
    }
  }

  // Commands
  console.log(picocolors.cyan(`\n  Commands`));
  console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
  console.log(`  ${picocolors.cyan("flowtask logs")} ${runId}`);
  console.log(`  ${picocolors.cyan("flowtask tasks --run")} ${runId}`);
  console.log(`  ${picocolors.cyan("flowtask artifacts")} ${runId}`);
  console.log(`  ${picocolors.cyan("flowtask validate")} ${runId}`);
  console.log(`  ${picocolors.cyan("flowtask diff --workflow")} ${runId}`);
  console.log(`  ${picocolors.cyan("flowtask duplicate")} ${runId}`);
  console.log(`  ${picocolors.cyan("flowtask export")} ${runId}`);
  console.log(`  ${picocolors.cyan("flowtask graph")} ${runId}`);
  console.log(`  ${picocolors.dim(`  Run directory: .flowtask/runs/${runId}`)}`);
  console.log("");
}
