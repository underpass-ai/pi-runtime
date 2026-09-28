import { AuditReport } from "../../domain/distribution/AuditReport.ts";
import type { PackageCoordinate } from "../../domain/distribution/PackageCoordinate.ts";
import type { VulnerabilityFinding } from "../../domain/distribution/VulnerabilityFinding.ts";
import type { VulnerabilityDatabase } from "../ports/VulnerabilityDatabase.ts";

const BATCH = 500;

export class AuditDependencyTree {
  readonly #db: VulnerabilityDatabase;
  constructor(db: VulnerabilityDatabase) { this.#db = db; }
  async execute(coordinates: PackageCoordinate[]): Promise<AuditReport> {
    const findings: VulnerabilityFinding[] = [];
    for (let i = 0; i < coordinates.length; i += BATCH) findings.push(...(await this.#db.findingsFor(coordinates.slice(i, i + BATCH))));
    return AuditReport.of(coordinates.length, findings);
  }
}
