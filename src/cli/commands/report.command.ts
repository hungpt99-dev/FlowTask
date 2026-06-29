import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { EventStore } from "../../core/event-store.js";
import { StepManager } from "../../core/step-manager.js";
import { DatabaseManager } from "../../core/database-manager.js";
import { FinalReportGenerator } from "../../core/final-report.js";
import { dbPath } from "../../utils/paths.js";
import picocolors from "picocolors";

export async function reportCommand(
  runId: string,
  options: { json?: boolean; output?: string },
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

  const tasks = await runManager.loadTasks(runId);
  const eventStore = new EventStore(rootPath);
  const events = await eventStore.readRunEvents(runId);
  const timeline = await runManager.getRunTimeline(runId);
  const runErrors = await runManager.getRunErrors(runId);
  const approvals = await runManager.getRunApprovals(runId);

  const stepManager = new StepManager(rootPath);
  const allStepsByTask = await stepManager.loadAllSteps(runId);
  const steps = Object.values(allStepsByTask).flat();

  const db = await DatabaseManager.create(dbPath(rootPath));
  const artifacts = db.getArtifactsByRun(runId);
  const auditSummary = await eventStore.getAuditSummary(runId);
  db.close();

  const generator = new FinalReportGenerator();
  const reportData = await generator.generateReport(run, tasks, {
    rootPath,
    steps,
    artifacts,
    fileChanges: [],
    validations: [],
    events,
    timeline,
    approvals,
    runErrors,
    workflowState: null,
    auditSummary: {
      total: auditSummary.total,
      errors: auditSummary.errors,
      warnings: auditSummary.warnings,
    },
  });

  if (options.json) {
    console.log(JSON.stringify(reportData, null, 2));
    return;
  }

  const markdown = generator.generateMarkdown(reportData);

  if (options.output) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(options.output, markdown, "utf-8");
    console.log(picocolors.green(`Report saved to: ${options.output}`));
    return;
  }

  console.log(markdown);
}
