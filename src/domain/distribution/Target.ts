import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const SUPPORTED = ["aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "aarch64-apple-darwin"] as const;
const DETECT: Record<string, string> = { "linux/arm64": SUPPORTED[0], "linux/x64": SUPPORTED[1], "darwin/arm64": SUPPORTED[2] };

export class Target extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): Target {
    if (!(SUPPORTED as readonly string[]).includes(raw)) throw DomainError.because(`unsupported target ${raw}`);
    return new Target(raw);
  }
  static detect(platform: string, arch: string): Target {
    const t = DETECT[`${platform}/${arch}`];
    if (!t) throw DomainError.because(`unsupported platform ${platform}/${arch}`);
    return new Target(t);
  }
  static all(): Target[] { return SUPPORTED.map((t) => new Target(t)); }
}
