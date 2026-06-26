import { type AiProviderRequest, type AiProviderResponse } from "./ai-provider.js";
import { AiProviderError } from "./ai-provider-error.js";

export interface ResponseFormatFallbackResult {
  response: AiProviderResponse;
  fallbackOccurred: boolean;
}

export async function generateWithResponseFormatFallback(
  providerName: string,
  request: AiProviderRequest,
  generateOnce: (request: AiProviderRequest) => Promise<AiProviderResponse>,
): Promise<ResponseFormatFallbackResult> {
  if (request.responseFormat !== "json_object") {
    return { response: await generateOnce(request), fallbackOccurred: false };
  }

  try {
    const response = await generateOnce(request);
    return { response, fallbackOccurred: false };
  } catch (err) {
    const isFormatError =
      err instanceof AiProviderError &&
      (err.kind === "unsupported_response_format" ||
        (err.kind === "invalid_request" &&
          (err.message?.includes("response_format") ||
            err.message?.includes("responseFormat") ||
            err.message?.includes("json_object") ||
            err.message?.includes("response_mime_type") ||
            err.message?.includes("responseMimeType"))));

    if (!isFormatError) {
      throw err;
    }

    const retryRequest: AiProviderRequest = {
      ...request,
      responseFormat: "text",
      metadata: {
        ...request.metadata,
        responseFormatFallback: true,
      },
    };

    let retryPrompt = request.systemPrompt;
    if (!retryPrompt.includes("strict JSON") && !retryPrompt.includes("ONLY valid JSON")) {
      retryPrompt =
        retryPrompt +
        "\n\nIMPORTANT: Return ONLY valid JSON. No markdown. No code fences. No prose before or after JSON. The first character must be `{` and the last must be `}`.";
    }

    const response = await generateOnce({
      ...retryRequest,
      systemPrompt: retryPrompt,
    });

    return { response, fallbackOccurred: true };
  }
}
