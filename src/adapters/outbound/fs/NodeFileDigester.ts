import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { FileDigester } from "../../../application/ports/FileDigester.ts";
import { Sha256Digest } from "../../../domain/distribution/Sha256Digest.ts";

export class NodeFileDigester implements FileDigester {
  async sha256(path: string): Promise<Sha256Digest> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return Sha256Digest.of(hash.digest("hex"));
  }
}
