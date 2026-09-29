import type { RefusalCode } from "./RefusalCode.ts";

export class ToolRefusal {
  readonly code: RefusalCode; readonly message: string; readonly retryable: boolean;
  private constructor(c: RefusalCode, m: string, r: boolean) { this.code = c; this.message = m; this.retryable = r; }
  static of(code: RefusalCode, message: string, retryable: boolean): ToolRefusal { return new ToolRefusal(code, message, retryable); }
  isSuccess(): false { return false; }
  describe(): string { return `${this.code}: ${this.message}`; }
}
