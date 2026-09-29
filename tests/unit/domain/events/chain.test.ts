import { test } from "node:test";
import assert from "node:assert/strict";
import { ContinuationSealer } from "../../../../src/domain/events/ContinuationSealer.ts";
import { StreamVerifier } from "../../../../src/domain/events/StreamVerifier.ts";
import { StreamHead } from "../../../../src/domain/events/StreamHead.ts";
import { EventRecord } from "../../../../src/domain/events/EventRecord.ts";
import { EventHash } from "../../../../src/domain/events/EventHash.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { CanonicalJson } from "../../../../src/domain/shared/CanonicalJson.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const opened = () => fact("session.opened", "opened.1", { reason: "startup" });

test("sella versiones contiguas, correlación, causación y cadena", () => {
  const [a, b] = ContinuationSealer.seal(null, [opened(), fact("turn.completed", "t1", { model: "m" })], AT);
  assert.deepEqual([a.version.value, b.version.value], [1, 2]);
  assert.equal(a.prevHash, null);
  assert.ok(b.prevHash!.equals(a.hash));
  assert.ok(a.correlationId.equals(a.id) && b.correlationId.equals(a.id));
  assert.equal(a.causationId, null);
  assert.ok(b.causationId!.equals(a.id));
  assert.ok(StreamVerifier.verify([a, b]).isIntact());
  const head = StreamHead.of({ stream: SESSION, version: b.version, hash: b.hash, lastEventId: b.id, correlationId: b.correlationId });
  const [c] = ContinuationSealer.seal(head, [fact("tool.started", "c1")], AT);
  assert.equal(c.version.value, 3);
  assert.ok(c.prevHash!.equals(b.hash) && c.causationId!.equals(b.id) && c.correlationId.equals(a.id));
  assert.ok(StreamVerifier.verify([a, b, c]).isIntact());
});

test("rechaza lotes vacíos, de otro stream o con ids duplicados", () => {
  assert.throws(() => ContinuationSealer.seal(null, [], AT), /empty/);
  assert.throws(() => ContinuationSealer.seal(null, [opened(), fact("host.started", "h", {}, StreamId.HOST)], AT), /one stream/);
  assert.throws(() => ContinuationSealer.seal(null, [opened(), opened()], AT), /duplicate/);
});

test("el verificador detecta cada defecto y un stream vacío es notFound", () => {
  const [a, b] = ContinuationSealer.seal(null, [opened(), fact("turn.completed", "t1")], AT);
  assert.equal(StreamVerifier.verify([]).kind, "notFound");
  const tampered = EventRecord.restore({ ...b, payload: CanonicalJson.of({ x: 1 }) });
  assert.deepEqual([StreamVerifier.verify([a, tampered]).kind, StreamVerifier.verify([a, tampered]).reason], ["broken", "digest mismatch"]);
  assert.equal(StreamVerifier.verify([b]).reason, "expected version 1");
  const badLink = EventRecord.restore({ ...b, prevHash: EventHash.of("0".repeat(64)) });
  assert.equal(StreamVerifier.verify([a, badLink]).reason, "broken link");
  const withPrev = EventRecord.restore({ ...a, prevHash: EventHash.of("0".repeat(64)) });
  assert.equal(StreamVerifier.verify([withPrev]).reason, "broken link");
  const [h] = ContinuationSealer.seal(null, [fact("host.started", "h", {}, StreamId.HOST)], AT);
  const mixed = EventRecord.restore({ ...h, version: b.version });
  assert.equal(StreamVerifier.verify([a, mixed]).reason, "mixed streams");
});

test("un hecho de sesión no puede ir al stream host", () => {
  assert.throws(() => fact("turn.completed", "x", {}, StreamId.HOST), DomainError);
});
