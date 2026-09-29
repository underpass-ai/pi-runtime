import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FingerprintRepository } from "../../../application/ports/FingerprintRepository.ts";
import { CatalogFingerprint } from "../../../domain/mcp/CatalogFingerprint.ts";

export class FsFingerprintRepository implements FingerprintRepository {
  readonly #file: string;
  constructor(file: string) { this.#file = file; }
  load(): Map<string, CatalogFingerprint> {
    if (!existsSync(this.#file)) return new Map();
    return new Map(Object.entries(JSON.parse(readFileSync(this.#file, "utf8")) as Record<string, string>).map(([k, v]) => [k, CatalogFingerprint.of(v)]));
  }
  save(m: Map<string, CatalogFingerprint>): void {
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, JSON.stringify(Object.fromEntries([...m].map(([k, v]) => [k, v.value])), null, 2));
  }
}
