import type { Check } from "./Check.ts";
import type { CheckSection } from "./CheckSection.ts";
import { CheckStatus } from "./CheckStatus.ts";

export class DiagnosisReport {
  readonly #checks: Check[];
  private constructor(c: Check[]) { this.#checks = c; }
  static of(checks: Check[]): DiagnosisReport { return new DiagnosisReport([...checks]); }
  add(...more: Check[]): DiagnosisReport { return new DiagnosisReport([...this.#checks, ...more]); }
  merge(other: DiagnosisReport): DiagnosisReport { return this.add(...other.checks()); }
  hasFailures(): boolean { return this.#checks.some((c) => c.status.equals(CheckStatus.FAIL)); }
  checks(): Check[] { return [...this.#checks]; }
  sections(): CheckSection[] {
    const out: CheckSection[] = [];
    for (const c of this.#checks) if (!out.some((s) => s.equals(c.section))) out.push(c.section);
    return out;
  }
}
