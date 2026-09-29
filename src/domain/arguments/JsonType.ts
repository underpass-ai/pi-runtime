import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const NAMES = new Set(["string", "number", "integer", "boolean", "null", "object", "array"]);
const isPlainObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

// Un `type` de JSON Schema. `admits` es tolerante a propósito: Pi 0.87.1 coacciona los primitivos
// antes de validar (null → 0/false/"", "3" → 3, 1 → true, 3 → "3"…), y el diagnóstico nunca
// debe rechazar lo que Pi acabaría aceptando.
export class JsonType extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): JsonType {
    if (typeof raw !== "string" || !NAMES.has(raw)) throw DomainError.because(`unknown JSON type ${String(raw)}`);
    return new JsonType(raw);
  }
  // El nombre del tipo de un valor, para el mensaje (`got string`).
  static nameOf(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
    return typeof value;
  }
  holds(value: unknown): boolean {
    switch (this.value) {
      case "string": return typeof value === "string";
      case "number": return typeof value === "number";
      case "integer": return typeof value === "number" && Number.isInteger(value);
      case "boolean": return typeof value === "boolean";
      case "null": return value === null;
      case "array": return Array.isArray(value);
      default: return isPlainObject(value);
    }
  }
  admits(value: unknown): boolean {
    if (this.holds(value)) return true;
    switch (this.value) {
      case "string": return value === null || typeof value === "number" || typeof value === "boolean";
      case "number": return value === null || typeof value === "boolean" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
      case "integer": return value === null || typeof value === "boolean" || (typeof value === "string" && value.trim() !== "" && Number.isInteger(Number(value)));
      case "boolean": return value === null || value === "true" || value === "false" || value === 0 || value === 1;
      case "null": return value === "" || value === 0 || value === false;
      default: return false;
    }
  }
}
