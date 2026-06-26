import { describe, it, expect } from "vitest";
import { detectOutputMode, createOutputOptions } from "../../src/ui/output-mode.js";

describe("detectOutputMode", () => {
  it("returns json when forceJson is true", () => {
    expect(detectOutputMode(false, false, true)).toBe("json");
  });

  it("returns rich when forceUi is true", () => {
    expect(detectOutputMode(true, false, false)).toBe("rich");
  });

  it("returns plain when forceNoUi is true", () => {
    expect(detectOutputMode(false, true, false)).toBe("plain");
  });

  it("returns plain when CI env is set", () => {
    const originalCi = process.env.CI;
    process.env.CI = "true";
    expect(detectOutputMode(false, false, false)).toBe("plain");
    process.env.CI = originalCi;
  });
});

describe("createOutputOptions", () => {
  it("creates options with correct mode from --json", () => {
    const opts = createOutputOptions({ json: true });
    expect(opts.mode).toBe("json");
  });

  it("creates options with verbose/debug/quiet flags", () => {
    const opts = createOutputOptions({ verbose: true, debug: true, quiet: false });
    expect(opts.verbose).toBe(true);
    expect(opts.debug).toBe(true);
    expect(opts.quiet).toBe(false);
  });
});
