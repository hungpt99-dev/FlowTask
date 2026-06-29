import { describe, it, expect } from "vitest";
import {
  buildErrorContext,
  classifyError,
  ERROR_SUGGESTIONS,
} from "../../src/utils/error-context.js";
import {
  FlowTaskError,
  TimeoutError,
  DependencyError,
  NetworkError,
  PermissionError,
  StuckProcessError,
  InvalidPlanError,
  CorruptedStateError,
  CostLimitError,
  ValidationError,
  ExecutorError,
} from "../../src/utils/errors.js";

describe("ErrorContext", () => {
  describe("buildErrorContext", () => {
    it("should create error context with defaults for step_failure", () => {
      const ctx = buildErrorContext("step_failure", "Task failed validation");
      expect(ctx.reason).toBe("Task failed validation");
      expect(ctx.suggestedFix).toBe(ERROR_SUGGESTIONS.step_failure);
      expect(ctx.retryable).toBe(false);
      expect(ctx.severity).toBe("error");
      expect(ctx.errorCode).toBe("step_failure");
      expect(ctx.userDecisionOptions).toHaveLength(3);
      expect(ctx.userDecisionOptions![0]!.action).toBe("retry");
    });

    it("should create error context with defaults for timeout", () => {
      const ctx = buildErrorContext("timeout", "Command timed out after 30s");
      expect(ctx.retryable).toBe(true);
      expect(ctx.userDecisionOptions).toHaveLength(3);
    });

    it("should create error context with defaults for network_error", () => {
      const ctx = buildErrorContext("network_error", "Connection refused");
      expect(ctx.retryable).toBe(true);
      expect(ctx.suggestedFix).toBe(ERROR_SUGGESTIONS.network_error);
    });

    it("should create error context with defaults for missing_dependency", () => {
      const ctx = buildErrorContext("missing_dependency", "Command not found: node");
      expect(ctx.retryable).toBe(true);
    });

    it("should create error context with defaults for permission_error", () => {
      const ctx = buildErrorContext("permission_error", "EACCES: permission denied");
      expect(ctx.retryable).toBe(false);
    });

    it("should create error context with defaults for cost_limit", () => {
      const ctx = buildErrorContext("cost_limit", "Cost limit exceeded");
      expect(ctx.retryable).toBe(false);
      expect(ctx.userDecisionOptions).toHaveLength(2);
      expect(ctx.userDecisionOptions![0]!.action).toBe("continue");
      expect(ctx.userDecisionOptions![1]!.action).toBe("cancel");
    });

    it("should create error context with defaults for approval_denied", () => {
      const ctx = buildErrorContext("approval_denied", "Approval denied by user");
      expect(ctx.retryable).toBe(false);
      expect(ctx.userDecisionOptions).toHaveLength(2);
      expect(ctx.userDecisionOptions![0]!.action).toBe("skip");
      expect(ctx.userDecisionOptions![1]!.action).toBe("cancel");
    });

    it("should create error context with defaults for corrupted_run_state", () => {
      const ctx = buildErrorContext("corrupted_run_state", "State file is corrupt");
      expect(ctx.retryable).toBe(false);
      expect(ctx.userDecisionOptions).toHaveLength(2);
    });

    it("should apply overrides correctly", () => {
      const ctx = buildErrorContext("step_failure", "Task failed", {
        evidence: "Exit code: 1",
        suggestedFix: "Check the logs",
        retryable: true,
        severity: "warning",
        source: "executor",
        details: { exitCode: 1 },
        userDecisionOptions: [
          { label: "Custom Retry", action: "retry", description: "Custom retry" },
        ],
      });
      expect(ctx.evidence).toBe("Exit code: 1");
      expect(ctx.suggestedFix).toBe("Check the logs");
      expect(ctx.retryable).toBe(true);
      expect(ctx.severity).toBe("warning");
      expect(ctx.source).toBe("executor");
      expect(ctx.details).toEqual({ exitCode: 1 });
      expect(ctx.userDecisionOptions).toHaveLength(1);
      expect(ctx.userDecisionOptions![0]!.label).toBe("Custom Retry");
    });
  });

  describe("classifyError", () => {
    it("should classify timeout errors", () => {
      const err = new Error("Command timed out after 30000ms");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("timeout");
      expect(ctx.retryable).toBe(true);
    });

    it("should classify ETIMEDOUT errors", () => {
      const err = new Error("Error: connect ETIMEDOUT 8.8.8.8:443");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("timeout");
      expect(ctx.retryable).toBe(true);
    });

    it("should classify ENOENT errors", () => {
      const err = new Error("ENOENT: no such file or directory, open '/nonexistent'");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("missing_dependency");
    });

    it("should classify command not found errors", () => {
      const err = new Error("command not found: node");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("missing_dependency");
    });

    it("should classify EACCES errors", () => {
      const err = new Error("EACCES: permission denied, open '/root/file'");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("permission_error");
    });

    it("should classify EPERM errors", () => {
      const err = new Error("EPERM: operation not permitted");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("permission_error");
    });

    it("should classify permission denied errors", () => {
      const err = new Error("permission denied: /etc/shadow");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("permission_error");
    });

    it("should classify network errors", () => {
      const err = new Error("ENOTFOUND: getaddrinfo ENOTFOUND api.example.com");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("network_error");
    });

    it("should classify ECONNREFUSED errors", () => {
      const err = new Error("ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8080");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("network_error");
    });

    it("should classify API key errors", () => {
      const err = new Error("API key not configured for provider");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("ai_provider_error");
    });

    it("should classify unauthorized errors", () => {
      const err = new Error("401: unauthorized - invalid API key");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("ai_provider_error");
    });

    it("should classify rate limit errors", () => {
      const err = new Error("429: too many requests, rate limit exceeded");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("ai_provider_error");
      expect(ctx.retryable).toBe(true);
    });

    it("should classify quota exceeded errors", () => {
      const err = new Error("insufficient_quota: you have exceeded your quota");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("ai_provider_error");
    });

    it("should classify planner errors", () => {
      const err = new Error("planner returned invalid output after retry");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("invalid_plan");
    });

    it("should classify unknown errors", () => {
      const err = new Error("Something unexpected happened");
      const ctx = classifyError(err);
      expect(ctx.errorCode).toBe("unknown");
      expect(ctx.retryable).toBe(false);
    });

    it("should handle non-Error objects", () => {
      const ctx = classifyError("string error");
      expect(ctx.errorCode).toBe("unknown");
      expect(ctx.reason).toBe("string error");
    });

    it("should handle null/undefined-like objects", () => {
      const ctx = classifyError(null);
      expect(ctx.errorCode).toBe("unknown");
      expect(ctx.reason).toBe("null");
    });

    it("should include stack trace as evidence for Error objects", () => {
      const err = new Error("test error");
      err.stack = "Error: test error\n    at Object.<anonymous> (/test/file.ts:1:1)";
      const ctx = classifyError(err);
      expect(ctx.evidence).toContain("Error: test error");
    });
  });
});

describe("FlowTaskError", () => {
  it("should create a basic error with code and message", () => {
    const err = new FlowTaskError("TEST_ERROR", "Test error message");
    expect(err.code).toBe("TEST_ERROR");
    expect(err.message).toBe("Test error message");
    expect(err.name).toBe("FlowTaskError");
    expect(err.retryable).toBe(false);
    expect(err.evidence).toBeUndefined();
    expect(err.suggestedFix).toBeUndefined();
  });

  it("should create an error with all optional fields", () => {
    const err = new FlowTaskError("TEST_ERROR", "Test error", {
      details: { key: "value" },
      evidence: "Error evidence here",
      suggestedFix: "Try fixing X",
      retryable: true,
      retrySuggestion: "Retry with flag --force",
      userReviewSuggestion: "Manual review needed",
      userDecisionOptions: [{ label: "Retry", action: "retry" }],
    });
    expect(err.details).toEqual({ key: "value" });
    expect(err.evidence).toBe("Error evidence here");
    expect(err.suggestedFix).toBe("Try fixing X");
    expect(err.retryable).toBe(true);
    expect(err.retrySuggestion).toBe("Retry with flag --force");
    expect(err.userReviewSuggestion).toBe("Manual review needed");
    expect(err.userDecisionOptions).toHaveLength(1);
  });

  it("should create a ValidationError with evidence", () => {
    const err = new ValidationError("Validation failed", {
      evidence: "Expected file not found",
      suggestedFix: "Create the missing file",
      retryable: true,
    });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.evidence).toBe("Expected file not found");
    expect(err.suggestedFix).toBe("Create the missing file");
    expect(err.retryable).toBe(true);
  });

  it("should create an ExecutorError with evidence", () => {
    const err = new ExecutorError("Process exited with code 1", {
      evidence: "Exit code: 1, stderr: error occurred",
      suggestedFix: "Check the command output",
      retryable: true,
    });
    expect(err.code).toBe("EXECUTOR_ERROR");
    expect(err.evidence).toContain("Exit code: 1");
  });

  it("should create a TimeoutError with retryable default", () => {
    const err = new TimeoutError("Timed out after 30s");
    expect(err.code).toBe("TIMEOUT_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.suggestedFix).toContain("increasing the timeout");
  });

  it("should create a DependencyError with retryable default", () => {
    const err = new DependencyError("Missing package", { dependency: "npm" });
    expect(err.code).toBe("DEPENDENCY_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.suggestedFix).toContain("npm");
  });

  it("should create a NetworkError with retryable default", () => {
    const err = new NetworkError("Connection refused");
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.retryable).toBe(true);
  });

  it("should create a PermissionError with non-retryable default", () => {
    const err = new PermissionError("Access denied");
    expect(err.code).toBe("PERMISSION_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.suggestedFix).toContain("permissions");
  });

  it("should create a StuckProcessError with retryable default and suggestion", () => {
    const err = new StuckProcessError("No output for 60s", {
      evidence: "Last output at 12:00:00",
    });
    expect(err.code).toBe("STUCK_PROCESS_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.evidence).toBe("Last output at 12:00:00");
    expect(err.retrySuggestion).toContain("Kill");
  });

  it("should create an InvalidPlanError with retryable default", () => {
    const err = new InvalidPlanError("Invalid plan output");
    expect(err.code).toBe("INVALID_PLAN_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.suggestedFix).toContain("Retry planning");
  });

  it("should create a CorruptedStateError with non-retryable default", () => {
    const err = new CorruptedStateError("State file parse failed", { runId: "run_123" });
    expect(err.code).toBe("CORRUPTED_STATE_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.suggestedFix).toContain("run_123");
  });

  it("should create a CostLimitError with user decision options", () => {
    const err = new CostLimitError("Cost limit reached $0.50", {
      currentCost: 0.5,
      maxCost: 1.0,
    });
    expect(err.code).toBe("COST_LIMIT_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.userDecisionOptions).toHaveLength(2);
    expect(err.userDecisionOptions![0]!.action).toBe("continue");
    expect(err.userDecisionOptions![1]!.action).toBe("cancel");
    expect(err.details).toBeDefined();
  });

  it("should be instanceof Error", () => {
    const err = new FlowTaskError("CODE", "msg");
    expect(err instanceof Error).toBe(true);
  });

  it("should be instanceof FlowTaskError for all subclasses", () => {
    const errors = [
      new TimeoutError("timeout"),
      new DependencyError("dep"),
      new NetworkError("network"),
      new PermissionError("perm"),
      new StuckProcessError("stuck"),
      new InvalidPlanError("plan"),
      new CorruptedStateError("corrupt"),
      new CostLimitError("cost"),
      new ValidationError("val"),
      new ExecutorError("exec"),
    ];
    for (const err of errors) {
      expect(err instanceof FlowTaskError).toBe(true);
      expect(err instanceof Error).toBe(true);
    }
  });
});
