import type { UiEvent } from "./event-bus.js";

export interface OutputBufferOptions {
  maxLines: number;
  flushIntervalMs: number;
  onFlush: (lines: UiEvent[]) => void;
}

export class OutputBuffer {
  private buffer: UiEvent[] = [];
  private maxLines: number;
  private flushIntervalMs: number;
  private onFlush: (lines: UiEvent[]) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: OutputBufferOptions) {
    this.maxLines = options.maxLines;
    this.flushIntervalMs = options.flushIntervalMs;
    this.onFlush = options.onFlush;
  }

  push(event: UiEvent): void {
    if (this.closed) return;
    this.buffer.push(event);
    if (this.buffer.length > this.maxLines) {
      this.buffer = this.buffer.slice(-this.maxLines);
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const lines = [...this.buffer];
    this.buffer = [];
    try {
      this.onFlush(lines);
    } catch {
      // flush errors are non-critical
    }
  }

  close(): void {
    this.closed = true;
    this.flush();
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
