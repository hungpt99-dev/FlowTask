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

  it("should block commands exposing env vars via env, set, declare", () => {
    expect(checker.check("env").riskLevel).toBe("blocked");
    expect(checker.check("set").riskLevel).toBe("blocked");
    expect(checker.check("declare").riskLevel).toBe("blocked");
  });

  it("should block echo of env vars", () => {
    const result = checker.check("echo $HOME");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should block data exfiltration via upload", () => {
    const result = checker.check("curl upload.example.com");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should block SSH key reading", () => {
    const result = checker.check("cat id_rsa");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should block rm -rf $HOME", () => {
    const result = checker.check("rm -rf $HOME");
    expect(result.riskLevel).toBe("blocked");
  });

  it("should mark npm install as risky", () => {
    expect(checker.check("npm install react").riskLevel).toBe("risky");
    expect(checker.check("pnpm install").riskLevel).toBe("risky");
  });

  it("should mark git push as risky", () => {
    const result = checker.check("git push origin main");
    expect(result.riskLevel).toBe("risky");
  });

  it("should mark safe commands as safe ignoring case", () => {
    expect(checker.check("LS -la").riskLevel).toBe("safe");
    expect(checker.check("ECHO hello").riskLevel).toBe("safe");
  });
});
