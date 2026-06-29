import type { ErrorContext, UserDecisionOption } from "./error-context.js";

export class FlowTaskError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly evidence?: string;
  public readonly suggestedFix?: string;
  public readonly retryable: boolean;
  public readonly retrySuggestion?: string;
  public readonly userReviewSuggestion?: string;
  public readonly userDecisionOptions?: UserDecisionOption[];
  public readonly errorContext?: ErrorContext;

  constructor(
    code: string,
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      evidence?: string;
      suggestedFix?: string;
      retryable?: boolean;
      retrySuggestion?: string;
      userReviewSuggestion?: string;
      userDecisionOptions?: UserDecisionOption[];
      errorContext?: ErrorContext;
    },
  ) {
    super(message);
    this.name = "FlowTaskError";
    this.code = code;
    this.details = opts?.details;
    this.evidence = opts?.evidence;
    this.suggestedFix = opts?.suggestedFix;
    this.retryable = opts?.retryable ?? false;
    this.retrySuggestion = opts?.retrySuggestion;
    this.userReviewSuggestion = opts?.userReviewSuggestion;
    this.userDecisionOptions = opts?.userDecisionOptions;
    this.errorContext = opts?.errorContext;
  }
}

export class ConfigError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFIG_ERROR", message, { details });
    this.name = "ConfigError";
  }
}

export class ValidationError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      evidence?: string;
      suggestedFix?: string;
      retryable?: boolean;
      retrySuggestion?: string;
      userReviewSuggestion?: string;
    },
  ) {
    super("VALIDATION_ERROR", message, opts);
    this.name = "ValidationError";
  }
}

export class StateError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("STATE_ERROR", message, { details });
    this.name = "StateError";
  }
}

export class ExecutorError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      evidence?: string;
      suggestedFix?: string;
      retryable?: boolean;
      retrySuggestion?: string;
    },
  ) {
    super("EXECUTOR_ERROR", message, opts);
    this.name = "ExecutorError";
  }
}

export class SafetyError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("SAFETY_ERROR", message, { details });
    this.name = "SafetyError";
  }
}

export class ProjectNotInitializedError extends FlowTaskError {
  constructor(rootPath: string) {
    super("PROJECT_NOT_INITIALIZED", `Project not initialized at: ${rootPath}`, {
      details: { rootPath },
    });
    this.name = "ProjectNotInitializedError";
  }
}

export class RunNotFoundError extends FlowTaskError {
  constructor(runId: string) {
    super("RUN_NOT_FOUND", `Run not found: ${runId}`, {
      details: { runId },
      suggestedFix: `Create the run first or check the run ID. Current runs: flowtask history`,
    });
    this.name = "RunNotFoundError";
  }
}

export class TimeoutError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      evidence?: string;
      retryable?: boolean;
    },
  ) {
    super("TIMEOUT_ERROR", message, {
      ...opts,
      retryable: opts?.retryable ?? true,
      suggestedFix: "Consider increasing the timeout or splitting the task into smaller steps.",
    });
    this.name = "TimeoutError";
  }
}

export class DependencyError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      dependency?: string;
    },
  ) {
    super("DEPENDENCY_ERROR", message, {
      details: opts?.details,
      suggestedFix: opts?.dependency
        ? `Install the missing dependency: ${opts.dependency}`
        : "Install the required dependency and retry.",
      retryable: true,
    });
    this.name = "DependencyError";
  }
}

export class NetworkError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      retryable?: boolean;
    },
  ) {
    super("NETWORK_ERROR", message, {
      details: opts?.details,
      suggestedFix: "Check your network connection and retry.",
      retryable: opts?.retryable ?? true,
    });
    this.name = "NetworkError";
  }
}

export class PermissionError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      requiredPath?: string;
    },
  ) {
    super("PERMISSION_ERROR", message, {
      details: opts?.details,
      suggestedFix: opts?.requiredPath
        ? `Check permissions for: ${opts.requiredPath}. Try: chmod or sudo.`
        : "Check file permissions or run with appropriate privileges.",
      retryable: false,
    });
    this.name = "PermissionError";
  }
}

export class StuckProcessError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      evidence?: string;
    },
  ) {
    super("STUCK_PROCESS_ERROR", message, {
      details: opts?.details,
      evidence: opts?.evidence,
      suggestedFix: "The process appears stuck. Kill it and retry.",
      retryable: true,
      retrySuggestion: "Kill the process and restart it.",
    });
    this.name = "StuckProcessError";
  }
}

export class InvalidPlanError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      suggestedFix?: string;
    },
  ) {
    super("INVALID_PLAN_ERROR", message, {
      details: opts?.details,
      suggestedFix: opts?.suggestedFix ?? "Retry planning or switch to simple planner mode.",
      retryable: true,
    });
    this.name = "InvalidPlanError";
  }
}

export class CorruptedStateError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      runId?: string;
    },
  ) {
    super("CORRUPTED_STATE_ERROR", message, {
      details: opts?.details,
      suggestedFix: opts?.runId
        ? `The run state for ${opts.runId} appears corrupted. Try recreating the run.`
        : "The state file appears corrupted. The run may need to be recreated.",
      retryable: false,
    });
    this.name = "CorruptedStateError";
  }
}

export class CostLimitError extends FlowTaskError {
  constructor(
    message: string,
    opts?: {
      details?: Record<string, unknown>;
      currentCost?: number;
      maxCost?: number;
    },
  ) {
    super("COST_LIMIT_ERROR", message, {
      details: {
        ...opts?.details,
        ...(opts?.currentCost !== undefined ? { currentCost: opts.currentCost } : {}),
        ...(opts?.maxCost !== undefined ? { maxCost: opts.maxCost } : {}),
      },
      suggestedFix: opts?.maxCost
        ? `Increase the max cost limit (currently $${opts.maxCost}) or optimize usage.`
        : "Increase the budget or reduce AI usage.",
      retryable: false,
      userDecisionOptions: [
        { label: "Continue anyway", action: "continue", description: "Bypass the cost limit" },
        { label: "Cancel workflow", action: "cancel", description: "Cancel the workflow" },
      ],
    });
    this.name = "CostLimitError";
  }
}
