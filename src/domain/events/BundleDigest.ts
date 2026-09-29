import { createHash } from "node:crypto";

export class BundleDigest {
  private constructor() {}
  static of(lines: string[]): string { return createHash("sha256").update(lines.join("\n")).digest("hex"); }
}
