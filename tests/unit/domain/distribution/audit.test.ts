import { test } from "node:test";
import assert from "node:assert/strict";
import { PackageCoordinate } from "../../../../src/domain/distribution/PackageCoordinate.ts";
import { AdvisoryId } from "../../../../src/domain/distribution/AdvisoryId.ts";
import { VulnerabilityFinding } from "../../../../src/domain/distribution/VulnerabilityFinding.ts";
import { AuditReport } from "../../../../src/domain/distribution/AuditReport.ts";
import { NpmPackageName } from "../../../../src/domain/distribution/NpmPackageName.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const coord = PackageCoordinate.of(NpmPackageName.of("chalk"), SemVer.of("5.4.1"));

test("coordenada, aviso y informe", () => {
  assert.equal(coord.key(), "chalk@5.4.1");
  assert.throws(() => AdvisoryId.of(" "), DomainError);
  assert.throws(() => VulnerabilityFinding.of(coord, []), /at least one advisory/);
  const report = AuditReport.of(3, [VulnerabilityFinding.of(coord, [AdvisoryId.of("GHSA-1")])]);
  assert.equal(report.isClean(), false);
  assert.equal(report.audited, 3);
  assert.equal(AuditReport.of(3, []).isClean(), true);
});
