export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[\d;]*[a-zA-Z]/g, "");
}

export class LineBuffer {
  private buffer = "";
  private onLine: (line: string) => void;
  private stripAnsi: boolean;

  constructor(onLine: (line: string) => void, opts?: { stripAnsi?: boolean }) {
    this.onLine = onLine;
    this.stripAnsi = opts?.stripAnsi ?? false;
  }

  push(data: Buffer): void {
    this.buffer += data.toString("utf-8");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      this.onLine(this.stripAnsi ? stripAnsi(line) : line);
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onLine(this.stripAnsi ? stripAnsi(this.buffer) : this.buffer);
      this.buffer = "";
    }
  }
}
