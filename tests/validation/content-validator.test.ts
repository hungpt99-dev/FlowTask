import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ContentValidator } from "../../src/validation/content-validator.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";

describe("ContentValidator", () => {
  const validator = new ContentValidator();
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "content-test-"));
    await ensureDir(tempDir);
    await writeTextFile(join(tempDir, "with-content.md"), "# Hello World\n\nThis has content.");
    await writeTextFile(join(tempDir, "empty-file.md"), "");
    await writeTextFile(join(tempDir, "whitespace-only.md"), "  \n  \n");
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return empty array for no content requirements", async () => {
    const checks = await validator.validateContent(tempDir, []);
    expect(checks).toHaveLength(0);
  });

  it("should pass for files with content", async () => {
    const checks = await validator.validateContent(tempDir, ["with-content.md"]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("passed");
    expect(checks[0]?.type).toBe("content");
    expect(checks[0]?.path).toBe("with-content.md");
  });

  it("should fail for non-existent files", async () => {
    const checks = await validator.validateContent(tempDir, ["non-existent.md"]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("failed");
  });

  it("should fail for empty files", async () => {
    const checks = await validator.validateContent(tempDir, ["empty-file.md"]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("failed");
    expect(checks[0]?.message).toContain("empty");
  });

  it("should fail for whitespace-only files", async () => {
    const checks = await validator.validateContent(tempDir, ["whitespace-only.md"]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("failed");
    expect(checks[0]?.message).toContain("meaningful content");
  });

  it("should handle multiple files", async () => {
    const checks = await validator.validateContent(tempDir, ["with-content.md", "non-existent.md"]);
    expect(checks).toHaveLength(2);
    const passed = checks.filter((c) => c.status === "passed");
    const failed = checks.filter((c) => c.status === "failed");
    expect(passed).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it("should handle absolute paths", async () => {
    const absolutePath = join(tempDir, "with-content.md");
    const checks = await validator.validateContent(tempDir, [absolutePath]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("passed");
  });
});
