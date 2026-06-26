export class LineBuffer {
  private buffer = "";
  private onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  push(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line) {
        this.onLine(line);
      }
    }
  }

  flush(): void {
    if (this.buffer) {
      this.onLine(this.buffer);
      this.buffer = "";
    }
  }
}
