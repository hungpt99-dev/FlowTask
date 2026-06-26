import { describe, it, expect } from "vitest";
import { SecretRedactor } from "../../src/safety/secret-redactor.js";

describe("SecretRedactor", () => {
  const redactor = new SecretRedactor();

  it("should redact TOKEN from text", () => {
    const result = redactor.redact("GITHUB_TOKEN=ghp_abc123def456");
    expect(result).toContain("****");
    expect(result).not.toContain("ghp_abc123def456");
  });

  it("should redact PASSWORD from text", () => {
    const result = redactor.redact("PASSWORD=super_secret_123");
    expect(result).toContain("PASSWORD=****");
    expect(result).not.toContain("super_secret_123");
  });

  it("should redact API_KEY from text", () => {
    const result = redactor.redact("API_KEY=sk-abc123xyz");
    expect(result).toContain("API_KEY=****");
  });

  it("should redact DATABASE_URL from text", () => {
    const result = redactor.redact("DATABASE_URL=postgres://user:pass@localhost/db");
    expect(result).toContain("DATABASE_URL=****");
  });

  it("should redact Bearer tokens", () => {
    const result = redactor.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token");
    expect(result).toContain("****");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("should pass through normal text unchanged", () => {
    const text = "Hello world, this is a normal log message.";
    const result = redactor.redact(text);
    expect(result).toBe(text);
  });

  it("should detect sensitive file paths", () => {
    expect(redactor.isSensitiveFilePath(".env")).toBe(true);
    expect(redactor.isSensitiveFilePath("path/to/.env.local")).toBe(true);
    expect(redactor.isSensitiveFilePath("~/.ssh/id_rsa")).toBe(true);
    expect(redactor.isSensitiveFilePath("config.pem")).toBe(true);
    expect(redactor.isSensitiveFilePath("secret.key")).toBe(true);
    expect(redactor.isSensitiveFilePath("id_ed25519")).toBe(true);
  });

  it("should NOT detect normal files as sensitive", () => {
    expect(redactor.isSensitiveFilePath("src/index.ts")).toBe(false);
    expect(redactor.isSensitiveFilePath("package.json")).toBe(false);
    expect(redactor.isSensitiveFilePath("README.md")).toBe(false);
  });
});
