import picocolors from "picocolors";

const DOCS_URL = "https://github.com/thanhhung-98/FlowTask";
const COMMANDS_URL = `${DOCS_URL}#usage`;
const GUIDES_URL = `${DOCS_URL}/blob/main/docs/guides`;
const REFERENCE_URL = `${DOCS_URL}/blob/main/docs/reference`;
const SETUP_URL = `${GUIDES_URL}/DEVELOPMENT.md`;
const TROUBLESHOOTING_URL = `${DOCS_URL}/blob/main/docs/guides/TROUBLESHOOTING.md`;

export interface CliErrorSuggestion {
  label: string;
  command: string;
  description?: string;
}

function formatDocLink(docLink?: string): string {
  if (docLink) return docLink;
  return COMMANDS_URL;
}

function printSuggestion(lines: string[], s: CliErrorSuggestion): void {
  const cmd = s.command ? picocolors.cyan(`  ${s.command}`) : "";
  const label = s.label ? `${picocolors.bold(s.label)}:` : "";
  lines.push(`  ${label} ${cmd}`);
  if (s.description) {
    lines.push(`  ${picocolors.dim(s.description)}`);
  }
}

export function formatCliError(
  title: string,
  reason: string,
  suggestions?: CliErrorSuggestion[],
  docLink?: string,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${picocolors.red("✗")} ${picocolors.bold(title)}`);
  lines.push("");
  lines.push(`  ${picocolors.dim("Reason:")}`);
  lines.push(`  ${reason}`);
  lines.push("");

  if (suggestions && suggestions.length > 0) {
    lines.push(`  ${picocolors.dim("Next steps:")}`);
    for (const s of suggestions) {
      printSuggestion(lines, s);
    }
    lines.push("");
  }

  lines.push(`  ${picocolors.dim(`Docs: ${formatDocLink(docLink)}`)}`);
  lines.push("");

  return lines.join("\n");
}

export function projectNotInitializedError(rootPath: string): string {
  return formatCliError(
    "FlowTask project not initialized",
    `No FlowTask project found at: ${rootPath}`,
    [
      {
        label: "Initialize",
        command: "flowtask init",
        description: "Creates a new FlowTask project in the current directory",
      },
      {
        label: "Force reinitialize",
        command: "flowtask init --force",
        description: "Reinitialize if already initialized",
      },
      {
        label: "Doctor",
        command: "flowtask doctor",
        description: "Run diagnostics to check your environment",
      },
    ],
    `${SETUP_URL}#setup`,
  );
}

export function runNotFoundError(runId: string): string {
  return formatCliError("Run not found", `No run with ID: ${runId}`, [
    {
      label: "List runs",
      command: "flowtask history",
      description: "Show all runs",
    },
    {
      label: "Start new run",
      command: 'flowtask run "your prompt"',
      description: "Create and run a new task",
    },
  ]);
}

export function stepNotFoundError(stepId: string, context?: string): string {
  return formatCliError(
    "Step not found",
    `Step "${stepId}"${context ? ` in ${context}` : ""} not found`,
    [
      {
        label: "Show task steps",
        command: "flowtask show <runId>",
        description: "View all steps in a task",
      },
      {
        label: "List runs",
        command: "flowtask history",
        description: "Show recent runs to find the correct run ID",
      },
    ],
  );
}

export function taskNotFoundError(taskId: string, runId?: string): string {
  return formatCliError(
    "Task not found",
    `Task "${taskId}"${runId ? ` in run ${runId}` : ""} not found`,
    [
      {
        label: "Show tasks",
        command: "flowtask tasks <runId>",
        description: "List all tasks in a run",
      },
      {
        label: "List runs",
        command: "flowtask history",
        description: "Show recent runs",
      },
    ],
  );
}

export function configError(key: string, reason?: string): string {
  return formatCliError(
    "Configuration error",
    reason ?? `Invalid or missing configuration: "${key}"`,
    [
      {
        label: "Set config",
        command: `flowtask config set ${key} <value>`,
        description: "Set a configuration value",
      },
      {
        label: "List config",
        command: "flowtask config list",
        description: "Show all configurable settings",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Validate your configuration and environment",
      },
    ],
    `${REFERENCE_URL}/COMMANDS.md#config`,
  );
}

export function plannerApiKeyMissing(provider: string, apiKeyEnv: string, model?: string): string {
  const getKeyUrl =
    provider === "openai"
      ? "https://platform.openai.com/api-keys"
      : provider === "anthropic"
        ? "https://console.anthropic.com/settings/keys"
        : provider === "gemini"
          ? "https://aistudio.google.com/app/apikey"
          : provider === "deepseek"
            ? "https://platform.deepseek.com/api_keys"
            : provider === "groq"
              ? "https://console.groq.com/keys"
              : undefined;

  const suggestions: CliErrorSuggestion[] = [
    {
      label: "Set env var",
      command: `export ${apiKeyEnv}=your-api-key`,
      description:
        "Set the API key in your shell profile (~/.zshrc, ~/.bashrc) or .env file, then restart your terminal",
    },
    {
      label: "Use simple planner",
      command: 'flowtask run --planner simple "your prompt"',
      description: "Skip AI planning and use the built-in simple planner",
    },
    {
      label: "Configure provider",
      command: "flowtask configure ai",
      description: "Interactive AI provider setup with guided prompts",
    },
    {
      label: "Run doctor",
      command: "flowtask doctor",
      description: "Check provider connectivity and environment",
    },
  ];

  if (getKeyUrl) {
    suggestions.unshift({
      label: "Get API key",
      command: "",
      description: `Create an API key at ${getKeyUrl}`,
    });
  }

  return formatCliError(
    "AI planner API key not configured",
    `Provider "${provider}" requires ${apiKeyEnv} environment variable.${model ? ` Model: ${model}` : ""}`,
    suggestions,
    `${SETUP_URL}#ai-provider-setup`,
  );
}

export function providerNotReachable(
  provider: string,
  baseUrl: string,
  errMessage: string,
): string {
  const isLocalProvider = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  const suggestions: CliErrorSuggestion[] = [];

  if (provider === "ollama" && isLocalProvider) {
    suggestions.push(
      {
        label: "Start Ollama",
        command: "ollama serve",
        description: "Start the Ollama server, then retry",
      },
      {
        label: "Pull a model",
        command: "ollama pull llama3.1",
        description: "Download a model if none are available locally",
      },
      {
        label: "Install Ollama",
        command: "brew install ollama",
        description:
          "macOS: brew install ollama. Linux: curl -fsSL https://ollama.ai/install.sh | sh",
      },
    );
  } else if (provider === "lmstudio" && isLocalProvider) {
    suggestions.push(
      {
        label: "Start LM Studio",
        command: "",
        description:
          "Open LM Studio, start the local inference server, and ensure the base URL matches",
      },
      {
        label: "Verify port",
        command: "",
        description: `Ensure LM Studio is running on port ${new URL(baseUrl).port || "1234"} and CORS is enabled`,
      },
    );
  }

  suggestions.push(
    {
      label: "Check network",
      command: "",
      description: isLocalProvider
        ? "Ensure the local service is running and not blocked by a firewall"
        : "Ensure the provider endpoint is accessible from your network (check proxies, VPN, and firewall settings)",
    },
    {
      label: "Verify config",
      command: "flowtask doctor",
      description: "Run diagnostics to check provider connectivity",
    },
    {
      label: "Use simple planner",
      command: 'flowtask run --planner simple "your prompt"',
      description: "Skip AI planning if AI is not needed",
    },
  );

  return formatCliError(
    `AI provider "${provider}" not reachable`,
    `Cannot reach ${baseUrl}: ${errMessage}`,
    suggestions,
    `${TROUBLESHOOTING_URL}#provider-connectivity`,
  );
}

export function cliToolNotFound(cmdName: string): string {
  const installHint =
    cmdName === "opencode" || cmdName === "opencode-cli"
      ? "npm install -g @opencode/cli"
      : cmdName === "claude"
        ? "npm install -g @anthropic-ai/claude-code"
        : cmdName === "codex"
          ? "npm install -g @openai/codex"
          : cmdName === "aider"
            ? "pip install aider-chat"
            : `npm install -g ${cmdName}`;

  return formatCliError(
    `CLI tool "${cmdName}" not found`,
    `The "${cmdName}" command is not installed or not in your PATH`,
    [
      {
        label: "Install",
        command: installHint,
        description: `Install ${cmdName} globally`,
      },
      {
        label: "Check PATH",
        command: `which ${cmdName} || echo "not found in PATH at:\n  echo $PATH"`,
        description: "Verify the command is installed and in your shell PATH",
      },
      {
        label: "List available executors",
        command: "flowtask doctor",
        description: "Check configured CLI tools and their availability",
      },
    ],
  );
}

export function envVarMissing(envVar: string, context?: string): string {
  return formatCliError(
    `Environment variable not set`,
    `${envVar}${context ? ` (${context})` : ""} is not set. FlowTask requires this variable to function.`,
    [
      {
        label: "Set temporarily",
        command: `export ${envVar}=your-value`,
        description: "Sets the variable for the current shell session only",
      },
      {
        label: "Set permanently",
        command: `echo 'export ${envVar}=your-value' >> ~/.zshrc`,
        description:
          "Add to your shell profile (~/.zshrc, ~/.bashrc, or ~/.profile) and restart your terminal",
      },
      {
        label: "Use .env file",
        command: `echo '${envVar}=your-value' >> .env`,
        description: "Create a .env file in the project root. FlowTask loads .env automatically",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Run diagnostics to verify your environment setup",
      },
    ],
    `${SETUP_URL}#environment-variables`,
  );
}

export function reinitializationConfirmation(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `  ${picocolors.yellow("!")} ${picocolors.bold("FlowTask already initialized in this directory.")}`,
  );
  lines.push("");
  lines.push(`  ${picocolors.dim("To reinitialize, use:")}`);
  lines.push(`  ${picocolors.cyan("  flowtask init --force")}`);
  lines.push("");
  lines.push(`  ${picocolors.dim("This will overwrite existing mode config and rules.")}`);
  lines.push(`  ${picocolors.dim("Your existing runs, tasks, and state data will be preserved.")}`);
  lines.push(`  ${picocolors.dim(`See: ${COMMANDS_URL}`)}`);
  lines.push("");
  return lines.join("\n");
}

export function forceReinitWarning(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `  ${picocolors.yellow("⚠")} ${picocolors.bold("Reinitializing FlowTask will overwrite:")}`,
  );
  lines.push("");
  lines.push(`  ${picocolors.dim("  • Mode configuration (.flowtask/config.json → projectMode)")}`);
  lines.push(`  ${picocolors.dim("  • Mode rules (.flowtask/rules/mode.md)")}`);
  lines.push(`  ${picocolors.dim("  • Step templates (.flowtask/steps/default.md)")}`);
  lines.push("");
  lines.push(`  ${picocolors.green("  ✓ Existing runs, tasks, and state will be preserved.")}`);
  lines.push("");
  lines.push(`  ${picocolors.dim("Continue with reinitialization?")}`);
  return lines.join("\n");
}

export function initializationFailedError(reason?: string): string {
  return formatCliError(
    "FlowTask initialization failed",
    reason ??
      "Could not create project files. The directory may not be writable or disk space may be insufficient.",
    [
      {
        label: "Check permissions",
        command: "ls -la .",
        description: "Verify you have write access to the current directory",
      },
      {
        label: "Check disk space",
        command: "df -h .",
        description: "Ensure there is enough free disk space available",
      },
      {
        label: "Retry with mode",
        command: "flowtask init --mode development",
        description: "Try initializing with an explicit project mode",
      },
      {
        label: "Force reinitialize",
        command: "flowtask init --force",
        description: "Force initialization if a partial .flowtask directory exists",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Check your environment for potential issues",
      },
    ],
    `${SETUP_URL}#setup`,
  );
}

export function projectLoadFailedError(rootPath: string): string {
  return formatCliError(
    "Failed to load project",
    `Could not read the FlowTask project at: ${rootPath}. The project file may be corrupted, have incorrect permissions, or be in an incompatible format.`,
    [
      {
        label: "Check file permissions",
        command: `ls -la ${rootPath}/.flowtask/`,
        description: "Ensure the .flowtask directory and files are readable",
      },
      {
        label: "Check project file",
        command: `cat ${rootPath}/.flowtask/project.json`,
        description: "Inspect the project file for corruption or invalid JSON",
      },
      {
        label: "Reinitialize",
        command: "flowtask init --force",
        description: "Recreate the project configuration (preserves existing config)",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Validate your project and environment",
      },
    ],
    `${REFERENCE_URL}/COMMANDS.md#init`,
  );
}

export function nodeVersionWarning(nodeVersion: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${picocolors.yellow("!")} ${picocolors.bold("Node.js version may be too old")}`);
  lines.push("");
  lines.push(`  ${picocolors.dim("Current:")} ${nodeVersion}`);
  lines.push(`  ${picocolors.dim("Recommended:")} v22 or later`);
  lines.push("");
  lines.push(
    `  ${picocolors.dim("FlowTask requires Node.js 22+. Older versions may not work correctly.")}`,
  );
  lines.push(
    `  ${picocolors.dim("Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash")}`,
  );
  lines.push(`  ${picocolors.dim("Then: nvm install 22 && nvm use 22")}`);
  lines.push(
    `  ${picocolors.dim("Alternative (fnm): brew install fnm && fnm install 22 && fnm use 22")}`,
  );
  lines.push(`  ${picocolors.dim("Or download from: https://nodejs.org/")}`);
  lines.push("");
  return lines.join("\n");
}

export function gitNotFoundError(): string {
  return formatCliError(
    "Git not found",
    "Git is not installed or not available in your PATH. Git is optional but recommended for source control and certain FlowTask features.",
    [
      {
        label: "Install git",
        command: "",
        description:
          "macOS: brew install git. Debian/Ubuntu: sudo apt-get install git. Windows: https://git-scm.com/downloads",
      },
      {
        label: "Check PATH",
        command: "which git || echo 'git not in PATH'",
        description: "Verify git is in your PATH if already installed",
      },
      {
        label: "Continue without git",
        command: "",
        description:
          "FlowTask works without git, but version tracking and git-based workflows will be unavailable",
      },
    ],
    "https://git-scm.com/",
  );
}

export function missingFlowtaskFileError(fileName: string, purpose: string): string {
  return formatCliError(
    `Missing .flowtask file: ${fileName}`,
    `The file ".flowtask/${fileName}" (${purpose}) was not found. This indicates a partial or corrupted initialization.`,
    [
      {
        label: "Reinitialize",
        command: "flowtask init --force",
        description: "Recreate missing files while preserving existing configuration",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Run diagnostics to check the .flowtask directory structure",
      },
    ],
    `${COMMANDS_URL}`,
  );
}

export function executorNotFoundError(executorName: string, command?: string): string {
  const installHint = command
    ? command.includes("npx")
      ? command
      : `npm install -g ${command}`
    : undefined;

  return formatCliError(
    `Executor "${executorName}" not available`,
    `The command "${command ?? executorName}" was not found in your PATH. This executor is configured but cannot be used.`,
    [
      ...(installHint
        ? [
            {
              label: "Install",
              command: installHint,
              description: `Install ${command ?? executorName} globally via npm`,
            } as CliErrorSuggestion,
          ]
        : [
            {
              label: "Install",
              command: "",
              description: `Ensure ${command ?? executorName} is installed and in your PATH`,
            } as CliErrorSuggestion,
          ]),
      {
        label: "Update config",
        command: `flowtask config set executors.${executorName}`,
        description: "Change the command path for this executor",
      },
      {
        label: "Use shell executor",
        command: "flowtask run --executor shell <prompt>",
        description: "Fall back to the built-in shell executor for your task",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Check executor availability and configuration",
      },
    ],
  );
}

export function providerNotConfiguredError(provider: string, setupCommand: string): string {
  return formatCliError(
    `AI provider "${provider}" not configured`,
    `The provider "${provider}" is not configured in .flowtask/config.json. Run "flowtask configure ai" to set it up.`,
    [
      {
        label: "Configure",
        command: setupCommand,
        description: "Set up this AI provider interactively",
      },
      {
        label: "Available providers",
        command: "flowtask configure ai",
        description: "Browse and configure available AI providers",
      },
      {
        label: "Use simple planner",
        command: 'flowtask run --planner simple "your prompt"',
        description: "Skip AI planning if you don't need an AI provider",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor --providers",
        description: "Check provider configuration and connectivity",
      },
    ],
    `${SETUP_URL}#ai-provider-setup`,
  );
}

export function responseTooLargeError(bytes: number, maxBytes: number, provider: string): string {
  return formatCliError(
    `Response too large from ${provider}`,
    `Response size (${bytes} bytes) exceeds the maximum allowed size (${maxBytes} bytes)`,
    [
      {
        label: "Reduce output",
        command: "",
        description:
          "Ask the AI model to produce shorter responses, or break the task into smaller steps",
      },
      {
        label: "Check model",
        command: "",
        description:
          "Some models produce larger outputs than others. Try a different model with lower max tokens",
      },
    ],
  );
}

export function globalInstallFailedError(errorMessage?: string): string {
  return formatCliError(
    "Failed to install FlowTask globally",
    errorMessage ??
      "Both pnpm and npm global installation failed. This may be due to permission issues, network problems, or missing dependencies.",
    [
      {
        label: "Install manually",
        command: "npm install -g .",
        description: "Run from the FlowTask project root directory",
      },
      {
        label: "Fix permissions",
        command: "npm config set prefix ~/.npm-global",
        description:
          "Avoid permission issues by installing to a user-owned directory, then add ~/.npm-global/bin to your PATH",
      },
      {
        label: "Use npx",
        command: "npx flowtask",
        description:
          "Run without global install — npx downloads and caches the package automatically",
      },
      {
        label: "Use Node version manager",
        command: "",
        description:
          "Install nvm (node version manager) to avoid permission issues entirely: nvm install 22 && nvm use 22",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Check your environment for issues that may block installation",
      },
    ],
    `${SETUP_URL}#setup`,
  );
}

export function globalInstallSuccess(installMethod: string): string {
  return [
    "",
    `  ${picocolors.green("✓")} ${picocolors.bold(`FlowTask installed globally via ${installMethod}`)}`,
    "",
    `  ${picocolors.dim("Next steps:")}`,
    `  ${picocolors.bold("Run diagnostics:")} ${picocolors.cyan("  flowtask doctor")}`,
    `  ${picocolors.bold("Initialize project:")} ${picocolors.cyan("  flowtask init")}`,
    `  ${picocolors.bold("Run a task:")} ${picocolors.cyan('  flowtask run "your prompt"')}`,
    "",
    `  ${picocolors.dim(`See: ${SETUP_URL}`)}`,
    "",
  ].join("\n");
}

export function unknownProviderError(provider: string): string {
  return formatCliError(
    `Unknown AI provider: "${provider}"`,
    `"${provider}" is not a supported AI provider. FlowTask supports a set of built-in providers for AI-powered planning and execution.`,
    [
      {
        label: "List providers",
        command: "flowtask setup ai",
        description: "Browse and configure available AI providers interactively",
      },
      {
        label: "Setup with provider",
        command: `flowtask setup ai --provider ${provider}`,
        description: "Try setting up this provider directly (if the name is correct)",
      },
      {
        label: "Use simple planner",
        command: 'flowtask run --planner simple "your prompt"',
        description: "Skip AI planning — use the built-in simple planner instead",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor --providers",
        description: "Check which providers are configured and available",
      },
    ],
    `${SETUP_URL}#ai-provider-setup`,
  );
}

export function missingDependencyError(
  dependency: string,
  installHint: string,
  purpose?: string,
): string {
  return formatCliError(
    `Missing dependency: ${dependency}`,
    `${dependency}${purpose ? ` (${purpose})` : ""} is required but not found in your PATH or system.`,
    [
      {
        label: "Install",
        command: installHint,
        description: `Install ${dependency}`,
      },
      {
        label: "Check PATH",
        command: `which ${dependency} || echo "not found"`,
        description: "Verify the dependency is installed and accessible from your shell",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Run diagnostics to check your environment and PATH setup",
      },
    ],
    `${SETUP_URL}#setup`,
  );
}

export function setupNotCompleteError(feature: string, setupCommand: string): string {
  return formatCliError(
    "Setup not complete",
    `FlowTask ${feature} has not been configured yet. Complete setup before using this feature.`,
    [
      {
        label: "Configure",
        command: setupCommand,
        description: `Set up ${feature}`,
      },
      {
        label: "List config",
        command: "flowtask config list",
        description: "View all configurable settings and their current state",
      },
      {
        label: "Run doctor",
        command: "flowtask doctor",
        description: "Validate your environment and see what needs configuration",
      },
    ],
    `${SETUP_URL}#setup`,
  );
}

export function healthCheckFailedError(
  endpoint: string,
  detail: string,
  suggestion?: string,
): string {
  const suggestions: CliErrorSuggestion[] = [
    {
      label: "Check network",
      command: "",
      description: "Ensure the endpoint is accessible. Verify proxies, VPN, and firewall settings",
    },
    {
      label: "Verify endpoint",
      command: `curl -I ${endpoint}`,
      description: "Test connectivity to the endpoint from your terminal",
    },
    {
      label: "Run doctor",
      command: "flowtask doctor",
      description: "Run full environment diagnostics to identify issues",
    },
  ];

  if (suggestion) {
    suggestions.unshift({
      label: "Suggestion",
      command: "",
      description: suggestion,
    });
  }

  return formatCliError(
    "Health check failed",
    `Could not reach ${endpoint}: ${detail}`,
    suggestions,
    `${TROUBLESHOOTING_URL}#provider-connectivity`,
  );
}

export function dockerNotAvailableError(): string {
  return formatCliError(
    "Docker not available",
    "Docker is required for this operation but was not found in your PATH or is not running.",
    [
      {
        label: "Install Docker",
        command: "",
        description:
          "macOS: brew install --cask docker. Linux: curl -fsSL https://get.docker.com | sh. See https://docker.com",
      },
      {
        label: "Start Docker",
        command: "open -a Docker",
        description: "Docker Desktop may be installed but not running",
      },
      {
        label: "Check Docker",
        command: "docker info",
        description: "Verify Docker is installed and the daemon is running",
      },
      {
        label: "Continue without Docker",
        command: "",
        description: "FlowTask can run without Docker — use direct CLI execution instead",
      },
    ],
    `${GUIDES_URL}/DEPLOYMENT.md#docker`,
  );
}

export function unknownInitModeError(mode: string): string {
  return formatCliError(
    `Unknown init mode: ${mode}`,
    `"${mode}" is not a valid project mode. FlowTask supports a set of predefined project modes for different use cases.`,
    [
      {
        label: "List modes",
        command: "flowtask init --show-modes",
        description: "View all available project modes with descriptions",
      },
      {
        label: "Use development mode",
        command: "flowtask init --mode development",
        description: "General-purpose mode for most projects",
      },
    ],
    `${REFERENCE_URL}/COMMANDS.md#init`,
  );
}

export function invalidConfigValueError(key: string, value: string, expected: string): string {
  return formatCliError(
    `Invalid config value for "${key}"`,
    `"${value}" is not valid for "${key}". Expected ${expected}.`,
    [
      {
        label: "Set correct value",
        command: `flowtask config set ${key} <${expected.replace(/\|/g, "|")}>`,
        description: `Set ${key} to a valid value (${expected})`,
      },
      {
        label: "List config",
        command: "flowtask config list",
        description: "View all configurable settings and their current values",
      },
    ],
    `${REFERENCE_URL}/COMMANDS.md#config`,
  );
}
