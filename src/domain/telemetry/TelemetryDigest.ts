import { createHash } from "node:crypto";

const utf8 = new TextEncoder();

// sha256 con el mismo encuadre que la cadena de E1: cada parte como
// "<bytesUtf8>:<valor>", así ninguna concatenación es ambigua ("ab"+"c" ≠ "a"+"bc").
export class TelemetryDigest {
  private constructor() {}
  static hex(domain: string, ...parts: string[]): string {
    const hash = createHash("sha256");
    for (const part of [domain, ...parts]) hash.update(`${utf8.encode(part).length}:${part}`);
    return hash.digest("hex");
  }
}
