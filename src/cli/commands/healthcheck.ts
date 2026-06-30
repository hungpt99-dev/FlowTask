import { ProjectManager } from "../../core/project-manager.js";
import { ConfigLoader } from "../../config/config-loader.js";
import { ProviderRegistry } from "../../ai/provider-registry.js";
import { LogManager } from "../../core/log-manager.js";
import { spawnWithPromise } from "../../utils/process.js";
import { fileExists, readDir } from "../../utils/fs.js";
import {
  getLogsDir,
  configJsonPath,
  projectJsonPath,
  stateJsonPath,
  runIndexPath,
  taskIndexPath,
} from "../../utils/paths.js";
import path from "node:path";
import picocolors from "picocolors";

interface HealthCheckResult {
  name: string;
  ok: boolean;
  status: "healthy" | "degraded" | "failing";
  message: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}

export interface RuntimeStatus {
  timestamp: string;
  overall: "healthy" | "degraded" | "failing";
  checks: HealthCheckResult[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    failing: number;
  };
}

export async function healthCheckCommand(options?: {
  json?: boolean;
  log?: boolean;
}): Promise<void> {
  const rootPath = process.cwd();
  const checks: HealthCheckResult[] = [];

  checks.push(await checkNodeVersion());
  checks.push(await checkInitialized(rootPath));
  checks.push(await checkGit());
  checks.push(await checkFlowtaskStructure(rootPath));
  checks.push(await checkConfig(rootPath));

  const providersCheck = await checkAiProviders(rootPath);
  checks.push(...providersCheck);

  checks.push(await checkLogAccess(rootPath));

  const healthy = checks.filter((c) => c.status === "healthy").length;
  const degraded = checks.filter((c) => c.status === "degraded").length;
  const failing = checks.filter((c) => c.status === "failing").length;

  const overall: RuntimeStatus["overall"] =
    failing > 0 ? "failing" : degraded > 0 ? "degraded" : "healthy";

  const status: RuntimeStatus = {
    timestamp: new Date().toISOString(),
    overall,
    checks,
    summary: { total: checks.length, healthy, degraded, failing },
  };

  if (options?.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printHealthReport(status);
  }

  if (options?.log) {
    await logHealthResults(rootPath, status);
  }

  process.exit(failing > 0 ? 1 : degraded > 0 ? 0 : 0);
}

async function logHealthResults(rootPath: string, status: RuntimeStatus): Promise<void> {
  try {
    const manager = new ProjectManager();
    const state = await manager.loadState(rootPath);
    const runId = state?.activeRunId ?? state?.lastRunId;
    if (!runId) return;

    const logManager = new LogManager(rootPath);
    await logManager.writeHealthCheck(runId, {
      overall: status.overall,
      healthy: status.summary.healthy,
      degraded: status.summary.degraded,
      failing: status.summary.failing,
      total: status.summary.total,
    });

    for (const check of status.checks) {
      if (!check.ok) {
        await logManager.writeRuntime(
          runId,
          `Health check fail: ${check.name} — ${check.message}`,
          "warn",
        );
      }
    }
  } catch {
    // Logging is best-effort during health check
  }
}

function printHealthReport(status: RuntimeStatus): void {
  const icon =
    status.overall === "healthy"
      ? picocolors.green("\u2713")
      : status.overall === "degraded"
        ? picocolors.yellow("!")
        : picocolors.red("\u2717");

  console.log(picocolors.cyan("\nFlowTask Health Check"));
  console.log(picocolors.dim("=".repeat(60)));
  console.log(`  Overall: ${icon} ${picocolors.bold(status.overall.toUpperCase())}`);
  console.log(`  Time: ${picocolors.dim(status.timestamp)}`);
  console.log("");

  for (const check of status.checks) {
    const ckIcon =
      check.status === "healthy"
        ? picocolors.green("\u2713")
        : check.status === "degraded"
          ? picocolors.yellow("!")
          : picocolors.red("\u2717");

    const ckColor =
      check.status === "healthy"
        ? picocolors.green
        : check.status === "degraded"
          ? picocolors.yellow
          : picocolors.red;

    console.log(`  ${ckIcon} ${picocolors.bold(check.name)}`);
    console.log(`    ${ckColor(check.message)}`);

    if (check.details && Object.keys(check.details).length > 0) {
      for (const [key, val] of Object.entries(check.details)) {
        console.log(`    ${picocolors.dim(key)}: ${val}`);
      }
    }

    if (check.suggestion) {
      console.log(`    ${picocolors.dim("\u2192 " + check.suggestion)}`);
    }
    console.log("");
  }

  console.log(picocolors.dim("\u2500".repeat(60)));
  console.log(
    `  ${status.summary.healthy} healthy, ${status.summary.degraded} degraded, ${status.summary.failing} failing`,
  );
  console.log("");
}

async function checkNodeVersion(): Promise<HealthCheckResult> {
  const major = parseInt(process.version.slice(1), 10);
  if (major >= 22) {
    return {
      name: "Node.js version",
      ok: true,
      status: "healthy",
      message: `${process.version} (22+)`,
      details: { version: process.version },
    };
  }
  return {
    name: "Node.js version",
    ok: false,
    status: "failing",
    message: `${process.version} — Node.js 22+ required`,
    suggestion: "Install Node.js 22+ from https://nodejs.org",
    details: { version: process.version },
  };
}

async function checkInitialized(rootPath: string): Promise<HealthCheckResult> {
  const manager = new ProjectManager();
  const initialized = await manager.isInitialized(rootPath);
  if (initialized) {
    return {
      name: "Project initialized",
      ok: true,
      status: "healthy",
      message: "FlowTask project is initialized",
    };
  }
  return {
    name: "Project initialized",
    ok: false,
    status: "failing",
    message: "Not initialized",
    suggestion: "Run: flowtask init",
  };
}

async function checkGit(): Promise<HealthCheckResult> {
  try {
    const result = await spawnWithPromise("git", ["--version"], { timeout: 5000 });
    const version = result.stdout.trim();
    return {
      name: "Git available",
      ok: true,
      status: "healthy",
      message: version,
      details: { version },
    };
  } catch {
    return {
      name: "Git available",
      ok: false,
      status: "degraded",
      message: "Git not found in PATH",
      suggestion: "Install git from https://git-scm.com",
    };
  }
}

async function checkFlowtaskStructure(rootPath: string): Promise<HealthCheckResult> {
  const requiredFiles = [
    ["project.json", projectJsonPath(rootPath)],
    ["state.json", stateJsonPath(rootPath)],
    ["run-index.json", runIndexPath(rootPath)],
    ["task-index.json", taskIndexPath(rootPath)],
  ];
  const results = await Promise.all(
    requiredFiles.map(async (entry) => {
      const name = entry[0]!;
      const p = entry[1]!;
      return { name, exists: await fileExists(p) };
    }),
  );
  const missing = results.filter((r) => !r.exists).map((r) => r.name);
  if (missing.length === 0) {
    return {
      name: ".flowtask structure",
      ok: true,
      status: "healthy",
      message: "All required files present",
    };
  }
  return {
    name: ".flowtask structure",
    ok: false,
    status: "degraded",
    message: `Missing files: ${missing.join(", ")}`,
    suggestion: "Run: flowtask init --force",
  };
}

async function checkConfig(rootPath: string): Promise<HealthCheckResult> {
  try {
    const loader = new ConfigLoader();
    const config = await loader.load(rootPath);
    const plannerMode = config.planner?.type ?? "internal-ai";
    const plannerProvider = config.planner?.provider ?? "openai";
    const executorCount = Object.keys(config.executors ?? {}).length;

    return {
      name: "Configuration",
      ok: true,
      status: "healthy",
      message: "Config loaded successfully",
      details: {
        mode: config.projectMode ?? "development",
        planner: `${plannerMode} (${plannerProvider})`,
        executors: executorCount,
      },
    };
  } catch (err) {
    return {
      name: "Configuration",
      ok: false,
      status: "failing",
      message: `Config load failed: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: "Run: flowtask doctor to diagnose config issues",
    };
  }
}

async function checkAiProviders(rootPath: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  try {
    const loader = new ConfigLoader();
    const config = await loader.load(rootPath);
    const registry = new ProviderRegistry(config);
    const providers = registry.listProviders();

    if (providers.length === 0) {
      results.push({
        name: "AI Providers — none configured",
        ok: false,
        status: "degraded",
        message: "No AI providers are configured",
        suggestion: "Run: flowtask configure ai",
      });
      return results;
    }

    const defaultProvider = config.planner?.provider ?? "openai";

    for (const p of providers) {
      if (p.needsApiKey && !p.apiKeyAvailable) {
        results.push({
          name: `Provider: ${p.name}`,
          ok: false,
          status: p.name === defaultProvider ? "failing" : "degraded",
          message: `${p.apiKeyEnv ?? `${p.name.toUpperCase()}_API_KEY`} not set`,
          suggestion: `Set ${p.apiKeyEnv ?? `${p.name.toUpperCase()}_API_KEY`}=your-api-key`,
        });
        continue;
      }

      if (!p.needsApiKey) {
        results.push({
          name: `Provider: ${p.name}`,
          ok: true,
          status: "healthy",
          message: `Type: ${p.type} — no API key needed`,
        });
        continue;
      }

      try {
        const provider = registry.getProvider(p.name);
        if (provider.healthCheck) {
          const health = await provider.healthCheck({ timeoutMs: 5000 });
          const providerResult: HealthCheckResult = {
            name: `Provider: ${p.name}`,
            ok: health.ok,
            status: health.ok ? "healthy" : p.name === defaultProvider ? "failing" : "degraded",
            message: health.message,
          };
          if (health.latencyMs !== undefined) {
            providerResult.details = { latency: `${health.latencyMs}ms` };
          }
          if (health.suggestion) {
            providerResult.suggestion = health.suggestion;
          }
          results.push(providerResult);
        } else {
          results.push({
            name: `Provider: ${p.name}`,
            ok: true,
            status: "healthy",
            message: `Type: ${p.type} — key found`,
          });
        }
      } catch (err) {
        results.push({
          name: `Provider: ${p.name}`,
          ok: false,
          status: p.name === defaultProvider ? "failing" : "degraded",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    results.push({
      name: "AI Providers",
      ok: false,
      status: "degraded",
      message: `Could not load provider config: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

async function checkLogAccess(rootPath: string): Promise<HealthCheckResult> {
  try {
    const manager = new ProjectManager();
    const state = await manager.loadState(rootPath);
    if (!state) {
      return {
        name: "Log access",
        ok: true,
        status: "healthy",
        message: "No active run — logs directory check skipped",
      };
    }

    const runId = state.activeRunId ?? state.lastRunId;
    if (!runId) {
      return {
        name: "Log access",
        ok: true,
        status: "healthy",
        message: "No runs found — logs directory not created yet",
      };
    }

    const logsDir = getLogsDir(rootPath, runId);
    const exists = await fileExists(logsDir);
    if (!exists) {
      return {
        name: "Log access",
        ok: true,
        status: "healthy",
        message: `No logs yet for run ${runId}`,
      };
    }

    const files = await readDir(logsDir);
    const logFiles = files.filter((f) => f.endsWith(".log") || f.endsWith(".jsonl"));
    return {
      name: "Log access",
      ok: true,
      status: "healthy",
      message: `${logFiles.length} log files for run ${runId}`,
      details: {
        runId,
        logFiles: logFiles.length,
      },
    };
  } catch (err) {
    return {
      name: "Log access",
      ok: false,
      status: "degraded",
      message: `Cannot access logs: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
