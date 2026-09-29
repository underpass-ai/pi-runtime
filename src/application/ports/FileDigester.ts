import type { Sha256Digest } from "../../domain/distribution/Sha256Digest.ts";

export interface FileDigester { sha256(path: string): Promise<Sha256Digest>; }
