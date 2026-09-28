import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuditDependencyTree } from "../../../../src/application/use-cases/AuditDependencyTree.ts";
import { ShrinkwrapMapper } from "../../../../src/application/mappers/ShrinkwrapMapper.ts";
import { VulnerabilityFinding } from "../../../../src/domain/distribution/VulnerabilityFinding.ts";
import { AdvisoryId } from "../../../../src/domain/distribution/AdvisoryId.ts";
import { PackageCoordinate } from "../../../../src/domain/distribution/PackageCoordinate.ts";
import { NpmPackageName } from "../../../../src/domain/distribution/NpmPackageName.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";

const dto = JSON.parse(readFileSync(new URL("../../../fixtures/shrinkwrap-small.json", import.meta.url), "utf8"));

test("el mapper deduplica, omite raíz y links", () => {
  assert.deepEqual(new ShrinkwrapMapper().toCoordinates(dto).map((c) => c.key()).sort(), ["chalk@4.1.2", "chalk@5.4.1", "jiti@2.7.0"]);
});

test("informa de hallazgos y trocea en lotes de 500", async () => {
  const sizes: number[] = [];
  const db = { findingsFor: async (batch: PackageCoordinate[]) => {
    sizes.push(batch.length);
    return batch.filter((c) => c.key() === "p7@1.0.0").map((c) => VulnerabilityFinding.of(c, [AdvisoryId.of("MAL-2025-1")]));
  } };
  const many = Array.from({ length: 1201 }, (_, i) => PackageCoordinate.of(NpmPackageName.of(`p${i}`), SemVer.of("1.0.0")));
  const report = await new AuditDependencyTree(db).execute(many);
  assert.deepEqual(sizes, [500, 500, 201]);
  assert.equal(report.audited, 1201);
  assert.deepEqual(report.findings().map((f) => f.coordinate.key()), ["p7@1.0.0"]);
});
