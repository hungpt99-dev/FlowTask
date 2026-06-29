/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { ArtifactManager } from "../../src/core/artifact-manager.js";
import { DatabaseManager } from "../../src/core/database-manager.js";
import { fileExists, readTextFile } from "../../src/utils/fs.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-art-test-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ArtifactManager", () => {
  let testDir: string;
  let am: ArtifactManager;

  beforeEach(() => {
    testDir = makeTestDir();
    am = new ArtifactManager();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("createArtifact", () => {
    it("creates a basic artifact file with metadata", async () => {
      const artifact = await am.createArtifact(testDir, {
        runId: "run_test",
        taskId: "task_test",
        title: "design.md",
        type: "report",
        content: "# Design\nContent",
        filePath: "output/design.md",
      });

      expect(artifact.artifactId).toMatch(/^artifact_/);
      expect(artifact.runId).toBe("run_test");
      expect(artifact.type).toBe("report");
      expect(artifact.origin).toBe("expected");
      expect(artifact.validationStatus).toBe("pending");
      expect(artifact.fileSize).toBeGreaterThan(0);
      expect(artifact.hashSha256).toBeTruthy();

      const written = await readTextFile(artifact.path);
      expect(written).toBe("# Design\nContent");
    });

    it("marks artifact as unexpected with origin option", async () => {
      const artifact = await am.createArtifact(testDir, {
        runId: "run_u",
        title: "unexpected.txt",
        type: "generated_artifact",
        content: "unexpected",
        filePath: "extra/unexpected.txt",
        origin: "unexpected",
      });

      expect(artifact.origin).toBe("unexpected");
    });

    it("includes optional stepId and summary", async () => {
      const artifact = await am.createArtifact(testDir, {
        runId: "run_s",
        stepId: "step_001",
        taskId: "task_001",
        title: "output.log",
        type: "log",
        content: "log output",
        filePath: "logs/output.log",
        summary: "Execution log for step 1",
      });

      expect(artifact.stepId).toBe("step_001");
      expect(artifact.summary).toBe("Execution log for step 1");
    });

    it("stores diff and diffStat when provided", async () => {
      const diff = "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new";
      const artifact = await am.createArtifact(testDir, {
        runId: "run_d",
        title: "changes.diff",
        type: "modified_file",
        content: "new content",
        filePath: "changes/file.txt",
        diff,
        diffStat: "1 insertion, 1 deletion",
      });

      expect(artifact.diff).toBe(diff);
      expect(artifact.diffStat).toBe("1 insertion, 1 deletion");
    });
  });

  describe("createFileArtifact", () => {
    it("creates file artifact with explicit type", async () => {
      const artifact = await am.createFileArtifact(testDir, "run_f", "src/new-file.ts", {
        type: "created_file",
        content: "export const x = 1;",
        summary: "New utility module",
      });

      expect(artifact.type).toBe("created_file");
      expect(artifact.summary).toBe("New utility module");
      expect(artifact.title).toBe("new-file.ts");
    });
  });

  describe("createReportArtifact", () => {
    it("creates a report artifact", async () => {
      const artifact = await am.createReportArtifact(
        testDir,
        "run_r",
        "Final Report",
        "# Final\n\nReport content",
      );

      expect(artifact.type).toBe("report");
      expect(artifact.title).toBe("Final Report");
      expect(artifact.path).toContain("report-final-report");
    });
  });

  describe("filtering and queries", () => {
    let db: DatabaseManager;

    beforeEach(async () => {
      db = await DatabaseManager.create(path.join(testDir, "flowtask.db"));
      am.setDatabase(db);

      const now = new Date().toISOString();
      db.insertRun({
        runId: "run_q",
        projectId: "test",
        title: "Query Test",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (let i = 1; i <= 3; i++) {
        db.insertTask({
          id: `task_${i}`,
          runId: "run_q",
          title: `Task ${i}`,
          status: "pending",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        });
        await am.createArtifact(testDir, {
          runId: "run_q",
          taskId: `task_${i}`,
          title: `file-${i}.txt`,
          type: i === 1 ? "report" : i === 2 ? "log" : "generated_artifact",
          content: `content ${i}`,
          filePath: `files/file-${i}.txt`,
          origin: i === 3 ? "unexpected" : "expected",
          summary: `Summary ${i}`,
        });
      }
    });

    afterEach(() => {
      db.close();
    });

    it("filters artifacts by type", () => {
      const results = am.getArtifactsByRunFiltered(testDir, "run_q", { type: "report" });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe("file-1.txt");
    });

    it("filters artifacts by origin", () => {
      const results = am.getArtifactsByRunFiltered(testDir, "run_q", { origin: "unexpected" });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe("file-3.txt");
    });

    it("filters artifacts by task", () => {
      const results = am.getArtifactsByRunFiltered(testDir, "run_q", { taskId: "task_1" });
      expect(results).toHaveLength(1);
    });

    it("provides summary statistics", async () => {
      const summary = await am.getArtifactsSummary(testDir, "run_q");
      expect(summary.total).toBe(3);
      expect(summary.expected).toBe(2);
      expect(summary.unexpected).toBe(1);
      expect(summary.byType.report).toBe(1);
      expect(summary.byOrigin.expected).toBe(2);
    });
  });

  describe("DB integration", () => {
    let db: DatabaseManager;

    beforeEach(async () => {
      db = await DatabaseManager.create(path.join(testDir, "flowtask.db"));
      am.setDatabase(db);

      const now = new Date().toISOString();
      db.insertRun({
        runId: "run_db",
        projectId: "test",
        title: "DB Test",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_db_1",
        runId: "run_db",
        title: "DB Task",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });
    });

    afterEach(() => {
      db.close();
    });

    it("persists artifact in DB when DB is set", async () => {
      await am.createArtifact(testDir, {
        runId: "run_db",
        taskId: "task_db_1",
        title: "db-test.md",
        type: "report",
        content: "# DB Test",
        filePath: "output/db-test.md",
      });

      const artifacts = am.getArtifactsByRun(testDir, "run_db");
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]!.type).toBe("report");
    });

    it("returns empty list when no artifacts match filter", () => {
      const results = am.getArtifactsByRunFiltered(testDir, "run_db", {
        type: "log",
      });
      expect(results).toHaveLength(0);
    });
  });

  describe("legacy compatibility", () => {
    it("saveArtifact creates artifact and returns legacy shape", async () => {
      const result = await am.saveArtifact(testDir, "run_l", "task_l", "legacy.md", "# Legacy");
      expect(result.artifactId).toMatch(/^artifact_/);
      expect(result.type).toBe("md");
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it("loadArtifact reads file content", async () => {
      const result = await am.saveArtifact(testDir, "run_l2", "task_l2", "hello.txt", "Hello!");
      const content = await am.loadArtifact(result.path);
      expect(content).toBe("Hello!");
    });
  });
});
