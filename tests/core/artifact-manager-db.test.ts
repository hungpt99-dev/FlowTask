import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { ArtifactManager } from "../../src/core/artifact-manager.js";
import { DatabaseManager } from "../../src/core/database-manager.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-art-db-test-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ArtifactManager with DB", () => {
  let testDir: string;
  let db: DatabaseManager;
  let artifactManager: ArtifactManager;

  beforeEach(async () => {
    testDir = makeTestDir();
    db = await DatabaseManager.create(path.join(testDir, "flowtask.db"));
    artifactManager = new ArtifactManager();
    artifactManager.setDatabase(db);

    const now = new Date().toISOString();
    db.insertRun({
      runId: "run_art_db",
      projectId: "test-project",
      title: "Artifact DB Test",
      status: "running",
      mode: "auto",
      taskCount: 0,
      completedTaskCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Insert tasks for FK references
    for (let i = 1; i <= 3; i++) {
      db.insertTask({
        id: `task_art_00${i}`,
        runId: "run_art_db",
        title: `Artifact Task ${i}`,
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("saves artifact file and persists metadata to DB", async () => {
    const artifact = await artifactManager.saveArtifact(
      testDir,
      "run_art_db",
      "task_art_001",
      "design.md",
      "# Design Document\n\nThis is a test design document.",
    );

    expect(artifact.artifactId).toMatch(/^artifact_/);
    expect(artifact.type).toBe("md");
    expect(fs.existsSync(artifact.path)).toBe(true);
    const content = fs.readFileSync(artifact.path, "utf-8");
    expect(content).toContain("Design Document");

    const artifacts = artifactManager.getArtifactsByRun(testDir, "run_art_db");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.title).toBe("design.md");
    expect(artifacts[0]!.type).toBe("generated_artifact");
  });

  it("saves multiple artifacts and retrieves by task", async () => {
    await artifactManager.saveArtifact(
      testDir,
      "run_art_db",
      "task_art_001",
      "req.md",
      "Requirements",
    );
    await artifactManager.saveArtifact(
      testDir,
      "run_art_db",
      "task_art_001",
      "design.md",
      "Design",
    );
    await artifactManager.saveArtifact(testDir, "run_art_db", "task_art_002", "test.md", "Tests");

    const taskArtifacts = artifactManager.getArtifactsByTask(testDir, "task_art_001");
    expect(taskArtifacts).toHaveLength(2);

    const runArtifacts = artifactManager.getArtifactsByRun(testDir, "run_art_db");
    expect(runArtifacts).toHaveLength(3);
  });

  it("loads artifact content by path", async () => {
    const artifact = await artifactManager.saveArtifact(
      testDir,
      "run_art_db",
      "task_001",
      "report.md",
      "# Final Report",
    );

    const content = await artifactManager.loadArtifact(artifact.path);
    expect(content).toBe("# Final Report");
  });

  it("returns empty list when DB is not configured", () => {
    const localManager = new ArtifactManager();
    const artifacts = localManager.getArtifactsByRun(testDir, "run_art_db");
    expect(artifacts).toEqual([]);
  });

  it("computes file size and hash correctly", async () => {
    const content = "Hello, World!";
    const artifact = await artifactManager.saveArtifact(
      testDir,
      "run_art_db",
      "task_art_003",
      "hello.txt",
      content,
    );

    expect(fs.existsSync(artifact.path)).toBe(true);

    const artifacts = artifactManager.getArtifactsByRun(testDir, "run_art_db");
    expect(artifacts[0]!.fileSize).toBe(Buffer.byteLength(content, "utf-8"));
  });
});
