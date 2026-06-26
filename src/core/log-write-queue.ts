export interface LogWriteQueueOptions {
  maxQueueSize?: number;
  highWatermark?: number;
}

export class LogWriteQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private maxQueueSize: number;
  private highWatermark: number;

  constructor(options: LogWriteQueueOptions = {}) {
    this.maxQueueSize = options.maxQueueSize ?? 10000;
    this.highWatermark = options.highWatermark ?? 5000;
  }

  enqueue(write: () => Promise<void>): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push(write);
    this.process();
  }

  size(): number {
    return this.queue.length;
  }

  isHighWatermark(): boolean {
    return this.queue.length >= this.highWatermark;
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      await this.processNext();
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      await this.processNext();
    }
    this.processing = false;
  }

  private async processNext(): Promise<void> {
    const write = this.queue.shift();
    if (!write) return;
    try {
      await write();
    } catch {
      // log write failures are non-critical
    }
  }
}
