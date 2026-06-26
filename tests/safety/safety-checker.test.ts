import { describe, it, expect } from "vitest";
import { SafetyChecker } from "../../src/safety/safety-checker.js";

describe("SafetyChecker", () => {
  const checker = new SafetyChecker();

  it("should mark safe commands as safe", () => {
    const result = checker.check("ls -la");
    expect(result.riskLevel).toBe("safe");
  });

  it("should mark git status as safe", () => {
    const result = checker.check("git status");
    expect(result.riskLevel).toBe("safe");
  });

  it("should block rm -rf /", () => {
    const result = checker.check("rm -rf /");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should block rm -rf .git", () => {
    const result = checker.check("rm -rf .git");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should block printenv", () => {
    const result = checker.check("printenv");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should block cat .env", () => {
    const result = checker.check("cat .env");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should mark pnpm add as risky", () => {
    const result = checker.check("pnpm add lodash");
    expect(result.riskLevel).toBe("risky");
  });

  it("should mark rm as risky", () => {
    const result = checker.check("rm file.txt");
    expect(result.riskLevel).toBe("risky");
  });
});
