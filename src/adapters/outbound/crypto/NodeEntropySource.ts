import { randomBytes } from "node:crypto";
import type { EntropySource } from "../../../application/ports/EntropySource.ts";

export class NodeEntropySource implements EntropySource {
  bytes(count: number): Uint8Array { return new Uint8Array(randomBytes(count)); }
}
