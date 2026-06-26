export class FlowTaskError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FlowTaskError";
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFIG_ERROR", message, details);
    this.name = "ConfigError";
  }
}

export class ValidationError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class StateError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("STATE_ERROR", message, details);
    this.name = "StateError";
  }
}

export class ExecutorError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("EXECUTOR_ERROR", message, details);
    this.name = "ExecutorError";
  }
}

export class SafetyError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("SAFETY_ERROR", message, details);
    this.name = "SafetyError";
  }
}

export class ProjectNotInitializedError extends FlowTaskError {
  constructor(rootPath: string) {
    super("PROJECT_NOT_INITIALIZED", `Project not initialized at: ${rootPath}`, {
      rootPath,
    });
    this.name = "ProjectNotInitializedError";
  }
}

export class RunNotFoundError extends FlowTaskError {
  constructor(runId: string) {
    super("RUN_NOT_FOUND", `Run not found: ${runId}`, { runId });
    this.name = "RunNotFoundError";
  }
}
