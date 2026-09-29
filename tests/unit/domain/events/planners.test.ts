import { test } from "node:test";
import assert from "node:assert/strict";
import { AppendPlanner } from "../../../../src/domain/events/AppendPlanner.ts";
import { ImportPlanner } from "../../../../src/domain/events/ImportPlanner.ts";
import { ContinuationSealer } from "../../../../src/domain/events/ContinuationSealer.ts";
import { StreamHead } from "../../../../src/domain/events/StreamHead.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Appended } from "../../../../src/domain/events/Appended.ts";
import { AppendConflict } from "../../../../src/domain/events/AppendConflict.ts";
import { BundleDigest } from "../../../../src/domain/events/BundleDigest.ts";
import { EventRecord } from "../../../../src/domain/events/EventRecord.ts";
import type { EventId } from "../../../../src/domain/events/EventId.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const headOf = (r: EventRecord) => StreamHead.of({ stream: r.stream, version: r.version, hash: r.hash, lastEventId: r.id, correlationId: r.correlationId });
const none = (_: EventId) => null;

test("append nuevo, conflicto de versión, idempotente y divergente", () => {
  const f1 = fact("session.opened", "o", { reason: "startup" });
  const first = AppendPlanner.plan(null, none, StreamVersion.NONE, [f1], AT);
  assert.ok(first.outcome instanceof Appended && !first.outcome.idempotent);
  assert.equal(first.toWrite.length, 1);
  const r1 = first.toWrite[0];

  const stale = AppendPlanner.plan(headOf(r1), none, StreamVersion.NONE, [fact("turn.completed", "t")], AT);
  assert.ok(stale.outcome instanceof AppendConflict && stale.outcome.reason === "version");
  assert.deepEqual([stale.outcome.expected.value, stale.outcome.actual.value, stale.toWrite.length], [0, 1, 0]);

  const find = (id: EventId) => (id.equals(r1.id) ? r1 : null);
  const again = AppendPlanner.plan(headOf(r1), find, StreamVersion.NONE, [f1], AT);
  assert.ok(again.outcome instanceof Appended && again.outcome.idempotent);
  assert.equal(again.toWrite.length, 0);

  const diverged = AppendPlanner.plan(headOf(r1), find, StreamVersion.of(1), [fact("session.opened", "o", { reason: "resume" })], AT);
  assert.ok(diverged.outcome instanceof AppendConflict && diverged.outcome.reason === "diverged");
});

test("import: prefijo idéntico más cola; rechaza divergencia, hueco y cadena rota", () => {
  const all = ContinuationSealer.seal(null, [fact("session.opened", "o"), fact("turn.completed", "t1"), fact("turn.completed", "t2")], AT);
  const existing = all.slice(0, 1);
  assert.equal(ImportPlanner.plan(() => existing, all).length, 2);
  assert.equal(ImportPlanner.plan(() => all, all).length, 0);
  const other = ContinuationSealer.seal(null, [fact("session.opened", "o", { reason: "other" })], AT);
  assert.throws(() => ImportPlanner.plan(() => other, all), /diverges/);
  assert.throws(() => ImportPlanner.plan(() => [], all.slice(1)), /gap/);
  const broken = [all[0], EventRecord.restore({ ...all[1], hash: all[2].hash })];
  assert.throws(() => ImportPlanner.plan(() => [], broken), /chain/);
  assert.equal(SESSION.value, all[0].stream.value);
});

test("digest de bundle estable", () => {
  assert.equal(BundleDigest.of(["a", "b"]), BundleDigest.of(["a", "b"]));
  assert.notEqual(BundleDigest.of(["a", "b"]), BundleDigest.of(["ab"]));
  assert.match(BundleDigest.of([]), /^[0-9a-f]{64}$/);
});
