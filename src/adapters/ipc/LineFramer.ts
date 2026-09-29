import { StringDecoder } from "node:string_decoder";

const MAX_PENDING = 16 * 1024 * 1024; // 16 MiB, in chars

export class LineFramer {
  readonly #decoder = new StringDecoder("utf8");
  readonly #onLine: (line: string) => void;
  readonly #onOverflow: () => void;
  #buf = "";

  constructor(onLine: (line: string) => void, onOverflow: () => void) {
    this.#onLine = onLine;
    this.#onOverflow = onOverflow;
  }

  push(chunk: Buffer): void {
    this.#buf += this.#decoder.write(chunk);
    let idx: number;
    while ((idx = this.#buf.indexOf("\n")) >= 0) {
      const line = this.#buf.slice(0, idx);
      this.#buf = this.#buf.slice(idx + 1);
      if (line.length > 0) this.#onLine(line);
    }
    if (this.#buf.length > MAX_PENDING) this.#onOverflow();
  }
}
