export class RingBuffer {
  private buffer: string[] = [];
  private maxLines: number;
  private maxLineLength: number;

  constructor(maxLines = 500, maxLineLength = 4000) {
    this.maxLines = maxLines;
    this.maxLineLength = maxLineLength;
  }

  push(line: string): void {
    const truncated =
      line.length > this.maxLineLength ? line.slice(0, this.maxLineLength) + "..." : line;
    this.buffer.push(truncated);
    if (this.buffer.length > this.maxLines) {
      this.buffer.shift();
    }
  }

  getLines(): string[] {
    return [...this.buffer];
  }

  getText(separator = "\n"): string {
    return this.buffer.join(separator);
  }

  clear(): void {
    this.buffer = [];
  }

  get length(): number {
    return this.buffer.length;
  }
}
