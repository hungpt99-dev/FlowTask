/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { FileTracker, type FileChange } from "../../src/core/file-tracker.js";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-ft-test-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("FileTracker", () => {
  let testDir: string;
  let ft: FileTracker;

  beforeEach(() => {
    testDir = makeTestDir();
    ft = new FileTracker();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("takeSnapshot", () => {
    it("captures file state into a snapshot", async () => {
      const filePath = path.join(testDir, "src", "hello.ts");
      await writeTextFile(filePath, "const x = 1;");

      const snapId = await ft.takeSnapshot(testDir, "run_s1", ["src/hello.ts"], "before-step");

      const snapPath = path.join(
        testDir,
        ".flowtask",
        "runs",
        "run_s1",
        "file-snapshots",
        "before-step.json",
      );
      expect(await fileExists(snapPath)).toBe(true);
      expect(snapId).toBe("before-step");
    });

    it("creates unique snapshot with timestamp label", async () => {
      const filePath = path.join(testDir, "data.txt");
      await writeTextFile(filePath, "data");

      const snapId = await ft.takeSnapshot(testDir, "run_s2", ["data.txt"]);

      expect(snapId).toMatch(/^snap-/);
    });

    it("records non-existent files as empty in snapshot", async () => {
      const result = await ft.takeSnapshot(testDir, "run_s3", ["nonexistent.ts"]);
      expect(result).toBeTruthy();

      // No changes if file still doesn't exist
      const changes = await ft.detectChanges(testDir, "run_s3", result);
      expect(changes).toHaveLength(0);
    });
  });

  describe("detectChanges", () => {
    it("detects created files", async () => {
      const beforeFile = path.join(testDir, "existing.txt");
      await writeTextFile(beforeFile, "original");

      const snapId = await ft.takeSnapshot(testDir, "run_d1", ["existing.txt", "new.txt"]);

      // Create a new file
      const newFile = path.join(testDir, "new.txt");
      await writeTextFile(newFile, "new content");

      const changes = await ft.detectChanges(testDir, "run_d1", snapId);

      const created = changes.filter((c) => c.type === "created");
      expect(created).toHaveLength(1);
      expect(created[0]!.filePath).toBe("new.txt");
    });

    it("detects modified files", async () => {
      const filePath = path.join(testDir, "modify.txt");
      await writeTextFile(filePath, "original");

      const snapId = await ft.takeSnapshot(testDir, "run_d2", ["modify.txt"]);

      // Modify the file
      await writeTextFile(filePath, "modified content");

      const changes = await ft.detectChanges(testDir, "run_d2", snapId);

      const modified = changes.filter((c) => c.type === "modified");
      expect(modified).toHaveLength(1);
      expect(modified[0]!.filePath).toBe("modify.txt");
    });

    it("detects deleted files", async () => {
      const filePath = path.join(testDir, "delete.txt");
      await writeTextFile(filePath, "to delete");

      const snapId = await ft.takeSnapshot(testDir, "run_d3", ["delete.txt"]);

      // Delete the file
      fs.rmSync(filePath);

      const changes = await ft.detectChanges(testDir, "run_d3", snapId);

      const deleted = changes.filter((c) => c.type === "deleted");
      expect(deleted).toHaveLength(1);
      expect(deleted[0]!.filePath).toBe("delete.txt");
    });

    it("detects multiple change types at once", async () => {
      const aPath = path.join(testDir, "a.txt");
      const bPath = path.join(testDir, "b.txt");
      await writeTextFile(aPath, "a");
      await writeTextFile(bPath, "b");

      const snapId = await ft.takeSnapshot(testDir, "run_d4", ["a.txt", "b.txt", "c.txt"]);

      await writeTextFile(aPath, "a modified");
      fs.rmSync(bPath);
      await writeTextFile(path.join(testDir, "c.txt"), "c created");

      const changes = await ft.detectChanges(testDir, "run_d4", snapId);

      expect(changes).toHaveLength(3);
      expect(changes.filter((c) => c.type === "modified")).toHaveLength(1);
      expect(changes.filter((c) => c.type === "deleted")).toHaveLength(1);
      expect(changes.filter((c) => c.type === "created")).toHaveLength(1);
    });
  });

  describe("categorizeChange", () => {
    it("categorizes .env files as sensitive", () => {
      const cat = ft.categorizeChange(".env");
      expect(cat).toBe("sensitive");
    });

    it("categorizes .env.production as sensitive", () => {
      const cat = ft.categorizeChange("config/.env.production");
      expect(cat).toBe("sensitive");
    });

    it("categorizes id_rsa as sensitive", () => {
      const cat = ft.categorizeChange("~/.ssh/id_rsa");
      expect(cat).toBe("sensitive");
    });

    it("categorizes .pem files as sensitive", () => {
      const cat = ft.categorizeChange("cert.pem");
      expect(cat).toBe("sensitive");
    });

    it("categorizes lockfiles", () => {
      expect(ft.categorizeChange("pnpm-lock.yaml")).toBe("lockfile");
      expect(ft.categorizeChange("package-lock.json")).toBe("lockfile");
      expect(ft.categorizeChange("yarn.lock")).toBe("lockfile");
      expect(ft.categorizeChange("Cargo.lock")).toBe("lockfile");
    });

    it("categorizes config files as env_config", () => {
      expect(ft.categorizeChange("tsconfig.json")).toBe("env_config");
      expect(ft.categorizeChange("config.yml")).toBe("env_config");
      expect(ft.categorizeChange(".gitignore")).toBe("env_config");
    });

    it("categorizes empty changes", () => {
      expect(ft.categorizeChange("plain.txt")).toBe("empty");
    });

    it("categorizes expected changes", () => {
      const cat = ft.categorizeChange(
        "src/app.ts",
        "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n",
        100,
      );
      expect(cat).toBe("expected");
    });
  });

  describe("trackChange and retrieval", () => {
    it("stores and retrieves a file change", async () => {
      const change = await ft.trackChange(testDir, "run_t1", {
        runId: "run_t1",
        taskId: "task_001",
        stepId: "step_001",
        type: "created",
        filePath: "src/new.ts",
        summary: "Created src/new.ts",
        diff: "+export const x = 1;",
        newSize: 50,
      });

      expect(change.changeId).toMatch(/^change_/);
      expect(change.category).toBe("expected");
      expect(change.detectedAt).toBeTruthy();

      const changes = await ft.getChangesByRun(testDir, "run_t1");
      expect(changes).toHaveLength(1);
      expect(changes[0]!.filePath).toBe("src/new.ts");
    });

    it("retrieves changes by step and task", async () => {
      await ft.trackChange(testDir, "run_t2", {
        runId: "run_t2",
        taskId: "task_a",
        stepId: "step_1",
        type: "modified",
        filePath: "src/a.ts",
        summary: "Modified a.ts",
      });
      await ft.trackChange(testDir, "run_t2", {
        runId: "run_t2",
        taskId: "task_b",
        stepId: "step_2",
        type: "created",
        filePath: "src/b.ts",
        summary: "Created b.ts",
      });

      const stepChanges = await ft.getChangesByStep(testDir, "run_t2", "step_1");
      expect(stepChanges).toHaveLength(1);

      const taskChanges = await ft.getChangesByTask(testDir, "run_t2", "task_b");
      expect(taskChanges).toHaveLength(1);
    });
  });

  describe("getDiffSummary", () => {
    it("returns accurate summary counts", async () => {
      // .env will be auto-categorized as sensitive
      await ft.trackChange(testDir, "run_sum", {
        runId: "run_sum",
        type: "modified",
        filePath: ".env",
        summary: "Modified env",
        diff: "some diff",
        newSize: 100,
      });
      // pnpm-lock.yaml will be auto-categorized as lockfile
      await ft.trackChange(testDir, "run_sum", {
        runId: "run_sum",
        type: "modified",
        filePath: "pnpm-lock.yaml",
        summary: "Updated lock",
        diff: "diff content",
        newSize: 200,
      });
      await ft.trackChange(testDir, "run_sum", {
        runId: "run_sum",
        type: "created",
        filePath: "src/new.ts",
        summary: "Created",
        diff: "+new file",
        newSize: 50,
      });

      const summary = await ft.getDiffSummary(testDir, "run_sum");
      expect(summary.total).toBe(3);
      expect(summary.created).toBe(1);
      expect(summary.modified).toBe(2);
      expect(summary.sensitive).toBe(1);
      expect(summary.lockfile).toBe(1);
    });
  });

  describe("getFullDiff", () => {
    it("returns null for unknown change ID", async () => {
      const diff = await ft.getFullDiff(testDir, "run_x", "nonexistent");
      expect(diff).toBeNull();
    });

    it("returns diff for tracked change", async () => {
      await ft.trackChange(testDir, "run_diff", {
        runId: "run_diff",
        type: "modified",
        filePath: "src/app.ts",
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
        summary: "Modified app.ts",
      });

      const changes = await ft.getChangesByRun(testDir, "run_diff");
      const diff = await ft.getFullDiff(testDir, "run_diff", changes[0]!.changeId);
      expect(diff).toContain("src/app.ts");
    });
  });
});
