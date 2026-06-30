export type AiProviderErrorKind =
  | "missing_api_key"
  | "unauthorized"
  | "rate_limited"
  | "quota_exceeded"
  | "model_not_found"
  | "unsupported_response_format"
  | "invalid_request"
  | "invalid_response"
  | "network_error"
  | "timeout"
  | "server_error"
  | "unknown";

export class AiProviderError extends Error {
  provider: string;
  kind: AiProviderErrorKind;
  statusCode?: number;
  retryable: boolean;
  suggestion?: string;
  cause?: unknown;

  constructor(opts: {
    provider: string;
    kind: AiProviderErrorKind;
    message: string;
    statusCode?: number;
    retryable?: boolean;
    suggestion?: string;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "AiProviderError";
    this.provider = opts.provider;
    this.kind = opts.kind;
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable ?? false;
    this.suggestion = opts.suggestion;
    this.cause = opts.cause;
  }
}

export function redactErrorMessage(message: string, secrets: Set<string>): string {
  let result = message;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    try {
      result = result.replace(
        new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        "[REDACTED]",
      );
    } catch {
      // skip invalid regex
    }
  }
  return result;
}

const MAX_RESPONSE_BYTES = 10_000_000;

export function checkResponseSize(response: Response, provider: string): void {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
    throw new AiProviderError({
      provider,
      kind: "invalid_response",
      message: `Response too large: ${contentLength} bytes exceeds limit of ${MAX_RESPONSE_BYTES} bytes`,
      suggestion:
        "Reduce the response size by asking for shorter output, using a model with lower max tokens, or breaking the task into smaller steps.",
    });
  }
}

export function getSuggestionForError(kind: AiProviderErrorKind, provider: string): string {
  switch (kind) {
    case "missing_api_key":
      return `Set the ${provider.toUpperCase()}_API_KEY environment variable, or run with --planner simple to skip AI planning.`;
    case "unauthorized":
      return `Check that your ${provider} API key is valid and has access to the selected model.`;
    case "rate_limited":
      return "Reduce request frequency or upgrade your API tier. The request can be retried.";
    case "quota_exceeded":
      return "Your API quota has been exceeded. Check your billing or wait for reset.";
    case "model_not_found":
      return `Check planner.model in .flowtask/config.json. The selected model may not exist or may not be accessible.`;
    case "unsupported_response_format":
      return `The provider does not support response_format json_object. FlowTask will retry without it.`;
    case "invalid_request":
      return "Check the request format. This may be a provider compatibility issue.";
    case "invalid_response":
      return "The provider returned an unexpected response format. This may be a compatibility issue.";
    case "network_error":
      return "Check your network connection and that the provider endpoint is reachable.";
    case "timeout":
      return "The provider took too long to respond. Retry or increase planner timeout.";
    case "server_error":
      return "The provider returned a server error. Retry later.";
    default:
      return "Run with --planner simple to skip AI planning, or check .flowtask/config.json.";
  }
}
