export class LineBuffer {
  private buffer = "";
  private onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  push(data: Buffer): void {
    this.buffer += data.toString("utf-8");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      this.onLine(line);
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onLine(this.buffer);
      this.buffer = "";
    }
  }
}
