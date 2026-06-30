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
  | "project_not_initialized"
  | "init_failed"
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
  missing_env_variable:
    "An environment variable is not set. Configure it in your shell or .env file and retry. Run: flowtask doctor",
  permission_error:
    "Permission denied. Check file permissions or run with appropriate user/group privileges.",
  network_error:
    "A network error occurred. Check your connection, firewall, proxy settings, and that the target endpoint is reachable.",
  api_error: "An API error occurred. Check the API status and your configuration.",
  ai_provider_error:
    "The AI provider returned an error. Check your API key, provider status, and configuration. Run: flowtask doctor --providers",
  ai_cli_error: "The AI CLI tool encountered an error. Review the CLI output.",
  invalid_plan: "The generated plan is invalid. Retry planning or use a different planner mode.",
  invalid_artifact: "The artifact validation failed. Check the artifact content.",
  invalid_validation_result: "The validation result is malformed or inconsistent.",
  corrupted_run_state: "The run state file appears corrupted. The run may need to be recreated.",
  cost_limit: "The cost limit has been reached. Increase the budget or optimize usage.",
  approval_denied: "The approval was denied by the user or policy.",
  project_not_initialized:
    "FlowTask is not initialized. Run: flowtask init. Use --force to reinitialize.",
  init_failed:
    "FlowTask initialization failed. Check that the directory is writable, disk space is available, and no existing .flowtask files are locked. Run: flowtask init --force to retry. For details, see: docs/guides/TROUBLESHOOTING.md#initialization-fails",
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
    case "init_failed":
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
    case "project_not_initialized":
      return [retry, cancel];
    case "init_failed":
      return [retry, cancel];
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
  _taskContext?: { taskId?: string; runId?: string },
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
      message.includes("not found") ||
      message.includes("Cannot find module") ||
      message.includes("Module not found")
    ) {
      return buildErrorContext("missing_dependency", message, {
        suggestedFix:
          "The required command or module was not found. Install the missing dependency and ensure it is in your PATH. Run: flowtask doctor to verify your environment. Check .flowtask/config.json for the correct executor command path.",
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
    if (message.includes("docker") || message.includes("Docker")) {
      return buildErrorContext("missing_dependency", message, {
        suggestedFix:
          "Docker is required but not found. Install Docker Desktop (macOS/Windows) or Docker Engine (Linux). Visit https://docker.com for installation instructions. If Docker is installed, ensure the daemon is running (docker info).",
        source: "executor",
      });
    }

    if (
      message.includes("npm ERR") ||
      message.includes("ERR_PNPM") ||
      message.includes("ERR! code")
    ) {
      return buildErrorContext("command_failure", message, {
        suggestedFix:
          "A package manager command failed. Check the output above for the specific error. Common issues: network connectivity, missing registry access, or conflicting dependencies. Try: npm cache clean --force && npm install, or delete node_modules and reinstall.",
        source: "executor",
      });
    }

    if (
      message.includes("module") &&
      (message.includes("not found") || message.includes("cannot find"))
    ) {
      return buildErrorContext("missing_dependency", message, {
        suggestedFix:
          "A required npm/pnpm module is missing. Run the install command for your package manager and retry.",
        source: "executor",
      });
    }

    if (message.includes("ETIMEDOUT") || message.includes("timeout")) {
      return buildErrorContext("timeout", message, { source: "executor" });
    }
    if (
      message.includes("_API_KEY") ||
      message.includes("_api_key") ||
      message.includes("environment variable not set")
    ) {
      return buildErrorContext("missing_env_variable", message, {
        suggestedFix:
          "Set the required environment variable. Run: flowtask doctor to check your setup.",
        source: "workflow",
        retryable: true,
      });
    }

    if (
      message.includes("API key") ||
      message.includes("api key") ||
      message.includes("unauthorized") ||
      message.includes("401")
    ) {
      return buildErrorContext("ai_provider_error", message, {
        suggestedFix:
          "Check your API key configuration. Set the required environment variable or run: flowtask configure ai",
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

    if (message.includes("not initialized") || message.includes("PROJECT_NOT_INITIALIZED")) {
      return buildErrorContext("project_not_initialized", message, {
        suggestedFix:
          "Run: flowtask init in your project directory. Use --force to reinitialize if already initialized.",
        source: "workflow",
      });
    }

    if (
      message.includes("init") &&
      (message.includes("fail") || message.includes("could not create"))
    ) {
      return buildErrorContext("init_failed", message, {
        suggestedFix:
          "Check directory write permissions (ls -la .), disk space (df -h .), and that no .flowtask files are locked by another process. Then retry: flowtask init --force",
        source: "workflow",
        retryable: true,
      });
    }

    if (
      message.includes("JSON") &&
      (message.includes("parse") || message.includes("parsing") || message.includes("invalid"))
    ) {
      return buildErrorContext("invalid_validation_result", message, {
        suggestedFix:
          "The AI provider returned invalid or non-JSON output. FlowTask will retry with a JSON-repair prompt. If this persists, switch to simple planner: flowtask run --planner simple. Check raw output in .flowtask/runs/<runId>/outputs/",
        source: "ai_provider",
        retryable: true,
      });
    }

    if (
      message.includes("EADDRINUSE") ||
      (message.includes("port") && message.includes("in use"))
    ) {
      return buildErrorContext("command_failure", message, {
        suggestedFix:
          "The required port is already in use. Stop the process using it (lsof -i :<port>) or configure a different port in .flowtask/config.json.",
        source: "executor",
        retryable: true,
      });
    }

    if (message.includes("disk") || message.includes("ENOSPC") || message.includes("no space")) {
      return buildErrorContext("command_failure", message, {
        suggestedFix:
          "Disk space is low or exhausted. Free up space (df -h .), clean temporary files, or remove old node_modules. Run: pnpm store prune or npm cache clean --force.",
        source: "executor",
        retryable: true,
      });
    }
  }

  return buildErrorContext("unknown", err instanceof Error ? err.message : String(err), {
    evidence: err instanceof Error ? err.stack : undefined,
    source: "workflow",
  });
}
