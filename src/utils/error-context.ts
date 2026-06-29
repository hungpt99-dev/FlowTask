export interface ErrorContext {
  reason: string;
  evidence?: string;
  suggestedFix?: string;
  retryable: boolean;
  retrySuggestion?: string;
  userReviewSuggestion?: string;
  userDecisionOptions?: UserDecisionOption[];
  errorCode?: string;
  source?: "workflow" | "executor" | "validation" | "ai_provider" | "safety" | "planning" | "state";
  severity: "error" | "warning" | "info";
  details?: Record<string, unknown>;
}

export interface UserDecisionOption {
  label: string;
  action: "retry" | "skip" | "continue" | "cancel" | "approve" | "reject" | "override" | "ignore";
  description?: string;
}

export type ErrorCategory =
  | "step_failure"
  | "command_failure"
  | "test_failure"
  | "build_failure"
  | "timeout"
  | "stuck_process"
  | "missing_dependency"
  | "missing_env_variable"
  | "permission_error"
  | "network_error"
  | "api_error"
  | "ai_provider_error"
  | "ai_cli_error"
  | "invalid_plan"
  | "invalid_artifact"
  | "invalid_validation_result"
  | "corrupted_run_state"
  | "cost_limit"
  | "approval_denied"
  | "unknown";

export const ERROR_SUGGESTIONS: Record<ErrorCategory, string> = {
  step_failure:
    "The step failed during execution. Review the task output and logs, then retry or skip.",
  command_failure:
    "The shell command exited with a non-zero code. Check the command output for details.",
  test_failure: "Tests failed. Review the test output to identify failing tests and fix them.",
  build_failure: "The build process failed. Check the build output for compilation errors.",
  timeout: "The operation timed out. Consider increasing the timeout or splitting the task.",
  stuck_process:
    "The process appears stuck with no output. It may need to be killed and restarted.",
  missing_dependency: "A required dependency is missing. Install it and retry.",
  missing_env_variable: "An environment variable is not set. Configure it and retry.",
  permission_error: "Permission denied. Check file permissions or run with appropriate privileges.",
  network_error: "A network error occurred. Check your connection and retry.",
  api_error: "An API error occurred. Check the API status and your configuration.",
  ai_provider_error: "The AI provider returned an error. Check your API key and provider status.",
  ai_cli_error: "The AI CLI tool encountered an error. Review the CLI output.",
  invalid_plan: "The generated plan is invalid. Retry planning or use a different planner mode.",
  invalid_artifact: "The artifact validation failed. Check the artifact content.",
  invalid_validation_result: "The validation result is malformed or inconsistent.",
  corrupted_run_state: "The run state file appears corrupted. The run may need to be recreated.",
  cost_limit: "The cost limit has been reached. Increase the budget or optimize usage.",
  approval_denied: "The approval was denied by the user or policy.",
  unknown: "An unexpected error occurred. Check the logs for details.",
};

export function buildErrorContext(
  category: ErrorCategory,
  message: string,
  overrides?: Partial<ErrorContext>,
): ErrorContext {
  const base: ErrorContext = {
    reason: message,
    evidence: overrides?.evidence,
    suggestedFix: overrides?.suggestedFix ?? ERROR_SUGGESTIONS[category],
    retryable: overrides?.retryable ?? isRetryable(category),
    retrySuggestion: overrides?.retrySuggestion,
    userReviewSuggestion: overrides?.userReviewSuggestion,
    userDecisionOptions: overrides?.userDecisionOptions ?? defaultDecisionOptions(category),
    errorCode: overrides?.errorCode ?? category,
    severity: overrides?.severity ?? "error",
    details: overrides?.details,
    source: overrides?.source,
  };
  return base;
}

function isRetryable(category: ErrorCategory): boolean {
  switch (category) {
    case "timeout":
    case "stuck_process":
    case "network_error":
    case "api_error":
    case "ai_provider_error":
    case "missing_dependency":
    case "missing_env_variable":
      return true;
    default:
      return false;
  }
}

function defaultDecisionOptions(category: ErrorCategory): UserDecisionOption[] {
  const retry: UserDecisionOption = {
    label: "Retry",
    action: "retry",
    description: "Retry the failed step",
  };
  const skip: UserDecisionOption = {
    label: "Skip",
    action: "skip",
    description: "Skip this step and continue",
  };
  const cancel: UserDecisionOption = {
    label: "Cancel",
    action: "cancel",
    description: "Cancel the entire workflow",
  };
  const continueAction: UserDecisionOption = {
    label: "Continue",
    action: "continue",
    description: "Continue despite the failure",
  };
  const ignore: UserDecisionOption = {
    label: "Ignore",
    action: "ignore",
    description: "Ignore this error and proceed",
  };

  switch (category) {
    case "timeout":
    case "stuck_process":
    case "network_error":
    case "api_error":
    case "ai_provider_error":
    case "missing_dependency":
    case "missing_env_variable":
      return [retry, skip, cancel];
    case "step_failure":
    case "command_failure":
    case "test_failure":
    case "build_failure":
    case "ai_cli_error":
      return [retry, skip, cancel];
    case "approval_denied":
      return [skip, cancel];
    case "cost_limit":
      return [continueAction, cancel];
    case "corrupted_run_state":
    case "invalid_plan":
    case "invalid_artifact":
    case "invalid_validation_result":
      return [skip, cancel];
    default:
      return [retry, skip, cancel];
  }
}

export function classifyError(
  err: unknown,
  taskContext?: { taskId?: string; runId?: string },
): ErrorContext {
  if (err instanceof Error) {
    const message = err.message;

    if (
      message.includes("timeout") ||
      message.includes("ETIMEDOUT") ||
      message.includes("timed out")
    ) {
      return buildErrorContext("timeout", message, { source: "executor" });
    }
    if (
      message.includes("ENOENT") ||
      message.includes("command not found") ||
      message.includes("not found")
    ) {
      return buildErrorContext("missing_dependency", message, {
        suggestedFix: "Install the missing dependency and retry.",
        source: "executor",
      });
    }
    if (
      message.includes("EACCES") ||
      message.includes("EACCESS") ||
      message.includes("permission denied") ||
      message.includes("EPERM")
    ) {
      return buildErrorContext("permission_error", message, {
        suggestedFix: "Check file permissions or run with elevated privileges.",
        source: "executor",
      });
    }
    if (
      message.includes("ENOTFOUND") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ECONNRESET") ||
      message.includes("network")
    ) {
      return buildErrorContext("network_error", message, {
        suggestedFix: "Check your network connection and retry.",
        source: "executor",
      });
    }
    if (message.includes("ETIMEDOUT") || message.includes("timeout")) {
      return buildErrorContext("timeout", message, { source: "executor" });
    }
    if (
      message.includes("API key") ||
      message.includes("api key") ||
      message.includes("unauthorized") ||
      message.includes("401")
    ) {
      return buildErrorContext("ai_provider_error", message, {
        suggestedFix: "Check your API key configuration.",
        source: "ai_provider",
      });
    }
    if (
      message.includes("rate limit") ||
      message.includes("429") ||
      message.includes("too many requests")
    ) {
      return buildErrorContext("ai_provider_error", message, {
        suggestedFix: "Reduce request frequency or upgrade your API tier.",
        retryable: true,
        source: "ai_provider",
      });
    }
    if (message.includes("quota") || message.includes("insufficient_quota")) {
      return buildErrorContext("ai_provider_error", message, {
        suggestedFix: "Your API quota has been exceeded. Check billing.",
        source: "ai_provider",
      });
    }
    if (
      (err as Error & { code?: string }).code === "PLANNER_INVALID_OUTPUT" ||
      message.includes("planner")
    ) {
      return buildErrorContext("invalid_plan", message, {
        suggestedFix: "Retry planning or switch to simple planner mode.",
        source: "planning",
      });
    }
  }

  return buildErrorContext("unknown", err instanceof Error ? err.message : String(err), {
    evidence: err instanceof Error ? err.stack : undefined,
    source: "workflow",
  });
}
