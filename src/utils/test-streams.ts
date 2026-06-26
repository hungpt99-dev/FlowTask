export function mockReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

export function makeSseChunk(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function makeSseChunks(events: Record<string, unknown>[]): string[] {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
}

export function makeNdjsonChunk(data: Record<string, unknown>): string {
  return `${JSON.stringify(data)}\n`;
}

export function makeNdjsonChunks(events: Record<string, unknown>[]): string[] {
  return events.map((e) => `${JSON.stringify(e)}\n`);
}

export function mockSseResponse(chunks: string[], headers?: Record<string, string>): Response {
  const stream = mockReadableStream(chunks);
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

export function mockNdjsonResponse(chunks: string[], headers?: Record<string, string>): Response {
  const stream = mockReadableStream(chunks);
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", ...headers },
  });
}
