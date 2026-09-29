import { DomainError } from "../shared/DomainError.ts";

const HEX = /^[0-9a-f]{64}$/;

// Secreto por instalación (32 bytes aleatorios) con el que se sala el id de proyecto
// de la telemetría. Nunca se imprime: toString y toJSON devuelven "[redacted]".
export class TelemetryKey {
  readonly #hex: string;
  private constructor(hex: string) { this.#hex = hex; }

  static of(raw: string): TelemetryKey {
    if (typeof raw !== "string" || !HEX.test(raw)) throw DomainError.because("telemetry key must be 64 lowercase hex characters");
    return new TelemetryKey(raw);
  }

  static fromBytes(bytes: Uint8Array): TelemetryKey {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw DomainError.because("telemetry key must be 32 bytes");
    return new TelemetryKey(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
  }

  reveal(): string { return this.#hex; }
  equals(o: TelemetryKey): boolean { return o.reveal() === this.#hex; }
  toString(): string { return "[redacted]"; }
  toJSON(): string { return "[redacted]"; }
}
