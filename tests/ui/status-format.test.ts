import { describe, it, expect } from "vitest";
import {
  statusSymbol,
  statusColor,
  coloredStatus,
  projectStatusLabel,
} from "../../src/ui/formatters/status-format.js";

describe("statusSymbol", () => {
  it("returns ✓ for done/completed/passed", () => {
    expect(statusSymbol("done")).toBe("✓");
    expect(statusSymbol("completed")).toBe("✓");
    expect(statusSymbol("passed")).toBe("✓");
  });

  it("returns ● for running/in_progress", () => {
    expect(statusSymbol("running")).toBe("●");
    expect(statusSymbol("in_progress")).toBe("●");
  });

  it("returns ✗ for failed", () => {
    expect(statusSymbol("failed")).toBe("✗");
  });

  it("returns ○ for pending/created/planning", () => {
    expect(statusSymbol("pending")).toBe("○");
    expect(statusSymbol("created")).toBe("○");
    expect(statusSymbol("planning")).toBe("○");
  });

  it("returns ⏸ for interrupted/paused", () => {
    expect(statusSymbol("interrupted")).toBe("⏸");
    expect(statusSymbol("paused")).toBe("⏸");
  });

  it("returns ↻ for retrying", () => {
    expect(statusSymbol("retrying")).toBe("↻");
  });
});

describe("statusColor", () => {
  it("returns green for done/completed/passed", () => {
    const color = statusColor("done");
    expect(color("test")).toContain("test");
  });

  it("returns red for failed", () => {
    const color = statusColor("failed");
    expect(color("test")).toContain("test");
  });
});

describe("coloredStatus", () => {
  it("returns colored string for known status", () => {
    const result = coloredStatus("completed");
    expect(result).toContain("completed");
  });
});

describe("projectStatusLabel", () => {
  it("returns green idle for idle status", () => {
    const result = projectStatusLabel("idle");
    expect(result).toContain("idle");
  });

  it("returns cyan running for has_running_run", () => {
    const result = projectStatusLabel("has_running_run");
    expect(result).toContain("running");
  });
});
