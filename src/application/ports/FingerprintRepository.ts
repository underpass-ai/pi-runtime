import type { CatalogFingerprint } from "../../domain/mcp/CatalogFingerprint.ts";

export interface FingerprintRepository { load(): Map<string, CatalogFingerprint>; save(fingerprints: Map<string, CatalogFingerprint>): void; }
