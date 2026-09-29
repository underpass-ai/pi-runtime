import type { VulnerabilityFinding } from "./VulnerabilityFinding.ts";

export class AuditReport {
  readonly audited: number; readonly #findings: VulnerabilityFinding[];
  private constructor(audited: number, findings: VulnerabilityFinding[]) { this.audited = audited; this.#findings = findings; }
  static of(audited: number, findings: VulnerabilityFinding[]): AuditReport { return new AuditReport(audited, findings); }
  isClean(): boolean { return this.#findings.length === 0; }
  findings(): VulnerabilityFinding[] { return [...this.#findings]; }
}
