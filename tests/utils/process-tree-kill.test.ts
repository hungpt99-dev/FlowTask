import { describe, it, expect } from "vitest";
import { setDetachedSpawnOptions, isAlive } from "../../src/utils/process-tree-kill.js";

describe("process-tree-kill", () => {
  it("should return spawn options with detached", () => {
    const opts = setDetachedSpawnOptions();
    expect(opts).toHaveProperty("detached");
  });

  it("should detect alive process", () => {
    const alive = isAlive(process.pid);
    expect(alive).toBe(true);
  });

  it("should detect dead process", () => {
    const alive = isAlive(999999999);
    expect(alive).toBe(false);
  });
});
