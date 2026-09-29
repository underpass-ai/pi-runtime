import type { StreamVersion } from "./StreamVersion.ts";

export class VerificationResult {
  readonly kind: "intact" | "broken" | "notFound"; readonly version: StreamVersion | null; readonly reason: string | null;
  private constructor(kind: "intact" | "broken" | "notFound", version: StreamVersion | null, reason: string | null) { this.kind = kind; this.version = version; this.reason = reason; }
  static intact(version: StreamVersion): VerificationResult { return new VerificationResult("intact", version, null); }
  static broken(version: StreamVersion, reason: string): VerificationResult { return new VerificationResult("broken", version, reason); }
  static notFound(): VerificationResult { return new VerificationResult("notFound", null, null); }
  isIntact(): boolean { return this.kind === "intact"; }
}
