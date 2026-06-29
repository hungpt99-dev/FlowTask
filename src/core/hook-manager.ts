import { spawn } from "node:child_process";
import { getShell, getShellCommandFlag } from "../utils/shell.js";
import type {
  HookEntry,
  ShellHookEntry,
  ScriptHookEntry,
  WebhookHookEntry,
} from "../schemas/config.schema.js";

export interface HookConfig {
  beforeRun?: HookEntry[];
  afterRun?: HookEntry[];
  beforeTask?: HookEntry[];
  afterTask?: HookEntry[];
  beforeRetry?: HookEntry[];
  afterRetry?: HookEntry[];
  onFailure?: HookEntry[];
  beforeScan?: HookEntry[];
  afterScan?: HookEntry[];
  beforePlan?: HookEntry[];
  afterPlan?: HookEntry[];
  beforeStep?: HookEntry[];
  afterStep?: HookEntry[];
  onStepFail?: HookEntry[];
  onStepRetry?: HookEntry[];
  onApprovalRequired?: HookEntry[];
  beforeValidate?: HookEntry[];
  afterValidate?: HookEntry[];
  onArtifactCreated?: HookEntry[];
  onFileChanged?: HookEntry[];
  onRunComplete?: HookEntry[];
  onRunFail?: HookEntry[];
  onRunCancel?: HookEntry[];
  failOnError?: boolean;
}

export interface HookContext {
  runId: string;
  taskId?: string;
  taskTitle?: string;
  stepId?: string;
  stepTitle?: string;
  retryCount?: number;
  maxRetries?: number;
  success?: boolean;
  error?: string;
  artifactId?: string;
  artifactType?: string;
  fileName?: string;
  validationStatus?: string;
  url?: string;
  method?: string;
  planType?: string;
}

export interface HookResult {
  entry: string;
  type: "shell" | "script" | "webhook";
  success: boolean;
  exitCode: number | null;
  statusCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class HookError extends Error {
  constructor(
    message: string,
    public results: HookResult[],
  ) {
    super(message);
    this.name = "HookError";
  }
}

function normalizeEntry(entry: HookEntry): {
  type: "shell" | "script" | "webhook";
  command?: string;
  path?: string;
  url?: string;
  method: string;
  args: string[];
  headers: Record<string, string>;
  timeoutMs: number;
  label: string;
} {
  if (typeof entry === "string") {
    return {
      type: "shell",
      command: entry,
      args: [],
      headers: {},
      method: "POST",
      timeoutMs: 30000,
      label: entry,
    };
  }
  if (entry.type === "shell") {
    const s = entry as ShellHookEntry;
    return {
      type: "shell",
      command: s.command,
      args: [],
      headers: {},
      method: "POST",
      timeoutMs: s.timeoutMs ?? 30000,
      label: s.command,
    };
  }
  if (entry.type === "script") {
    const s = entry as ScriptHookEntry;
    return {
      type: "script",
      path: s.path,
      args: s.args ?? [],
      headers: {},
      method: "POST",
      timeoutMs: s.timeoutMs ?? 60000,
      label: `${s.path}${s.args?.length ? " " + s.args.join(" ") : ""}`,
    };
  }
  const w = entry as WebhookHookEntry;
  return {
    type: "webhook",
    url: w.url,
    method: w.method ?? "POST",
    headers: w.headers ?? {},
    args: [],
    timeoutMs: w.timeoutMs ?? 10000,
    label: `${w.method} ${w.url}`,
  };
}

function buildEnv(context: HookContext, rootPath: string): Record<string, string> {
  const env: Record<string, string> = {
    HOOK_RUN_ID: context.runId,
    HOOK_ROOT_PATH: rootPath,
  };
  if (context.taskId) env.HOOK_TASK_ID = context.taskId;
  if (context.taskTitle) env.HOOK_TASK_TITLE = context.taskTitle;
  if (context.stepId) env.HOOK_STEP_ID = context.stepId;
  if (context.stepTitle) env.HOOK_STEP_TITLE = context.stepTitle;
  if (context.retryCount !== undefined) env.HOOK_RETRY_COUNT = String(context.retryCount);
  if (context.maxRetries !== undefined) env.HOOK_MAX_RETRIES = String(context.maxRetries);
  if (context.success !== undefined) env.HOOK_SUCCESS = String(context.success);
  if (context.error) env.HOOK_ERROR = context.error;
  if (context.artifactId) env.HOOK_ARTIFACT_ID = context.artifactId;
  if (context.artifactType) env.HOOK_ARTIFACT_TYPE = context.artifactType;
  if (context.fileName) env.HOOK_FILE_NAME = context.fileName;
  if (context.validationStatus) env.HOOK_VALIDATION_STATUS = context.validationStatus;
  if (context.planType) env.HOOK_PLAN_TYPE = context.planType;
  if (context.url) env.HOOK_URL = context.url;
  if (context.method) env.HOOK_METHOD = context.method;
  return env;
}

function executeShell(
  command: string,
  rootPath: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const shell = getShell();
    const flag = getShellCommandFlag();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const child = spawn(shell, [flag, command], {
      cwd: rootPath,
      env: { ...process.env, ...env } as Record<string, string>,
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
    });

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        entry: command,
        type: "shell",
        success: exitCode === 0,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const isTimeout = err.name === "AbortError" || stderr.includes("aborted");
      resolve({
        entry: command,
        type: "shell",
        success: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: isTimeout ? `Hook timed out after ${timeoutMs}ms` : err.message,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

function executeScript(
  scriptPath: string,
  args: string[],
  rootPath: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const shell = getShell();
    const flag = getShellCommandFlag();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const quoted = [scriptPath, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
    const child = spawn(shell, [flag, quoted], {
      cwd: rootPath,
      env: { ...process.env, ...env } as Record<string, string>,
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
    });

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        entry: `${scriptPath}${args.length ? " " + args.join(" ") : ""}`,
        type: "script",
        success: exitCode === 0,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        entry: scriptPath,
        type: "script",
        success: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: err.message,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

async function executeWebhook(
  url: string,
  method: string,
  headers: Record<string, string>,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<HookResult> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
        "X-Hook-Environment": JSON.stringify(env),
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    const body = await response.text().catch(() => "");

    return {
      entry: `${method} ${url}`,
      type: "webhook",
      success: response.ok,
      exitCode: response.status,
      statusCode: response.status,
      stdout: body,
      stderr: response.ok ? "" : `HTTP ${response.status}: ${response.statusText}`,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      entry: `${method} ${url}`,
      type: "webhook",
      success: false,
      exitCode: null,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}

async function executeEntry(
  entry: HookEntry,
  context: HookContext,
  rootPath: string,
): Promise<HookResult> {
  const norm = normalizeEntry(entry);
  const env = buildEnv(context, rootPath);

  switch (norm.type) {
    case "shell":
      return executeShell(norm.command!, rootPath, env, norm.timeoutMs);
    case "script":
      return executeScript(norm.path!, norm.args, rootPath, env, norm.timeoutMs);
    case "webhook":
      return executeWebhook(norm.url!, norm.method, norm.headers, env, norm.timeoutMs);
  }
}

export class HookManager {
  private config: HookConfig;
  private rootPath: string;

  constructor(rootPath: string, config?: HookConfig) {
    this.rootPath = rootPath;
    this.config = config ?? {};
  }

  private async executeHooks(
    entries: HookEntry[] | undefined,
    context: HookContext,
  ): Promise<HookResult[]> {
    if (!entries || entries.length === 0) return [];

    const results: HookResult[] = [];

    for (const entry of entries) {
      const result = await executeEntry(entry, context, this.rootPath);
      results.push(result);
      if (!result.success && this.config.failOnError) {
        throw new HookError(
          `Hook failed: ${result.entry}${result.stderr ? "\n" + result.stderr : ""}`,
          results,
        );
      }
    }

    return results;
  }

  async runBeforeRun(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeRun, context);
  }

  async runAfterRun(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterRun, context);
  }

  async runBeforeTask(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeTask, context);
  }

  async runAfterTask(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterTask, context);
  }

  async runBeforeRetry(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeRetry, context);
  }

  async runAfterRetry(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterRetry, context);
  }

  async runOnFailure(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onFailure, context);
  }

  async runBeforeScan(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeScan, context);
  }

  async runAfterScan(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterScan, context);
  }

  async runBeforePlan(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforePlan, context);
  }

  async runAfterPlan(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterPlan, context);
  }

  async runBeforeStep(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeStep, context);
  }

  async runAfterStep(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterStep, context);
  }

  async runOnStepFail(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onStepFail, context);
  }

  async runOnStepRetry(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onStepRetry, context);
  }

  async runOnApprovalRequired(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onApprovalRequired, context);
  }

  async runBeforeValidate(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.beforeValidate, context);
  }

  async runAfterValidate(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.afterValidate, context);
  }

  async runOnArtifactCreated(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onArtifactCreated, context);
  }

  async runOnFileChanged(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onFileChanged, context);
  }

  async runOnRunComplete(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onRunComplete, context);
  }

  async runOnRunFail(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onRunFail, context);
  }

  async runOnRunCancel(context: HookContext): Promise<HookResult[]> {
    return this.executeHooks(this.config.onRunCancel, context);
  }
}
