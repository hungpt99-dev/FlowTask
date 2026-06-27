export class RingBuffer {
  private buffer: string[];
  private maxLines: number;
  private maxLineLength: number;
  private head = 0;
  private count = 0;

  constructor(maxLines = 500, maxLineLength = 4000) {
    this.maxLines = maxLines;
    this.maxLineLength = maxLineLength;
    this.buffer = new Array(maxLines);
  }

  push(line: string): void {
    const truncated =
      line.length > this.maxLineLength ? line.slice(0, this.maxLineLength) + "..." : line;
    this.buffer[this.head] = truncated;
    this.head = (this.head + 1) % this.maxLines;
    if (this.count < this.maxLines) this.count++;
  }

  getLines(): string[] {
    const result: string[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head - this.count + i + this.maxLines) % this.maxLines]!);
    }
    return result;
  }

  getText(separator = "\n"): string {
    return this.getLines().join(separator);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }
}
