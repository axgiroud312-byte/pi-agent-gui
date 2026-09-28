/** LF is the only delimiter; decoding must never split U+2028 or U+2029. */
export class RpcJsonlDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private text = '';
  private bytes = 0;
  private dropping = false;
  private ended = false;
  private readonly maxRecordBytes: number;
  private readonly onLine: (line: string) => void;
  private readonly onProblem: (message: string) => void;

  constructor(
    maxRecordBytes: number,
    onLine: (line: string) => void,
    onProblem: (message: string) => void,
  ) {
    this.maxRecordBytes = maxRecordBytes;
    this.onLine = onLine;
    this.onProblem = onProblem;
  }

  push(chunk: Buffer): void {
    if (this.ended) return;
    let offset = 0;
    while (offset < chunk.length && !this.ended) {
      const newline = chunk.indexOf(10, offset);
      const end = newline === -1 ? chunk.length : newline;
      this.append(chunk.subarray(offset, end));
      if (newline === -1) return;
      this.finishLine();
      offset = newline + 1;
    }
  }

  end(): void {
    if (this.ended) return;
    // Flush a final record even when stdout has no terminating LF.
    if (this.bytes > 0 || this.dropping) this.finishLine();
    this.discard();
  }

  discard(): void {
    this.ended = true;
    this.text = '';
    this.bytes = 0;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
  }

  private append(bytes: Buffer): void {
    if (this.dropping) return;
    this.bytes += bytes.length;
    if (this.bytes > this.maxRecordBytes) {
      this.drop(`stdout record exceeds ${this.maxRecordBytes} bytes; discarded through the next LF`);
      return;
    }
    try {
      this.text += this.decoder.decode(bytes, { stream: true });
    } catch {
      this.drop('Invalid UTF-8 on stdout; discarded through the next LF');
    }
  }

  private drop(message: string): void {
    this.text = '';
    this.bytes = 0;
    this.dropping = true;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.onProblem(message);
  }

  private finishLine(): void {
    if (!this.dropping) {
      try {
        this.text += this.decoder.decode();
      } catch {
        this.drop('Incomplete UTF-8 on stdout; record discarded');
      }
    }
    const line = this.dropping ? '' : this.text;
    this.text = '';
    this.bytes = 0;
    this.dropping = false;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    if (line.length > 0 && !this.ended) {
      this.onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
  }
}
