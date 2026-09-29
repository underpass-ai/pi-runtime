import { test } from "node:test";
import assert from "node:assert/strict";
import { Check } from "../../../../src/domain/diagnosis/Check.ts";
import { CheckSection } from "../../../../src/domain/diagnosis/CheckSection.ts";
import { CheckName } from "../../../../src/domain/diagnosis/CheckName.ts";
import { CheckDetail } from "../../../../src/domain/diagnosis/CheckDetail.ts";
import { CheckStatus } from "../../../../src/domain/diagnosis/CheckStatus.ts";
import { DiagnosisReport } from "../../../../src/domain/diagnosis/DiagnosisReport.ts";
import { FingerprintDrift } from "../../../../src/domain/diagnosis/FingerprintDrift.ts";
import { CatalogFingerprint } from "../../../../src/domain/mcp/CatalogFingerprint.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const n = CheckName.of("x"); const d = CheckDetail.of("y");

test("report acumula, detecta FAIL y conserva orden de secciones", () => {
  const r = DiagnosisReport.of([Check.ok(CheckSection.KMP, n, d)]).add(Check.fail(CheckSection.MADE, n, d), Check.warn(CheckSection.KMP, n, d));
  assert.equal(r.hasFailures(), true);
  assert.deepEqual(r.sections().map(String), ["kmp", "made"]);
  assert.equal(DiagnosisReport.of([Check.ok(CheckSection.PI, n, d)]).hasFailures(), false);
  assert.ok(Check.fail(CheckSection.PI, n, d).status.equals(CheckStatus.FAIL));
  assert.throws(() => CheckName.of(""), DomainError);
  assert.throws(() => CheckSection.of("db"), DomainError);
  assert.equal(CheckSection.of("events"), CheckSection.EVENTS);
  assert.ok(CheckSection.of("telemetry").equals(CheckSection.TELEMETRY));
  assert.equal(CheckSection.of("learning"), CheckSection.LEARNING);
});

test("deriva de huellas: nueva, igual y cambiada", () => {
  const a = CatalogFingerprint.of("a".repeat(64)); const b = CatalogFingerprint.of("b".repeat(64));
  const checks = FingerprintDrift.compare(new Map([["made", a], ["kmp", a]]), new Map([["made", b], ["kmp", a]]));
  assert.deepEqual(checks.map((c) => [c.section.value, c.status.value]), [["kmp", "OK"], ["made", "WARN"]]);
  assert.match(FingerprintDrift.compare(new Map(), new Map([["kmp", a]]))[0].detail.value, /recorded/);
});
