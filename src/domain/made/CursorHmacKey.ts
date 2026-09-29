import { DomainError } from "../shared/DomainError.ts";

export class CursorHmacKey {
  readonly #hex: string;
  private constructor(hex: string) { this.#hex = hex; }
  static of(raw: string): CursorHmacKey {
    if (typeof raw !== "string" || !/^[0-9a-f]{64}$/.test(raw)) throw DomainError.because("cursor HMAC key must be 64 lowercase hex characters");
    return new CursorHmacKey(raw);
  }
  reveal(): string { return this.#hex; }
  equals(o: CursorHmacKey): boolean { return o.reveal() === this.#hex; }
  toString(): string { return "[redacted]"; }
  toJSON(): string { return "[redacted]"; }
}
