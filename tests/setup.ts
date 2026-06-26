import { beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export let testDir: string;

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-test-"));
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});
