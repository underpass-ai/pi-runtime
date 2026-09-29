import { test } from "node:test";
import assert from "node:assert/strict";
import { SystemClock } from "../../../../../src/adapters/outbound/clock/SystemClock.ts";
import { Timestamp } from "../../../../../src/domain/events/Timestamp.ts";

test("now() devuelve un Timestamp construido a partir del reloj real", () => {
  const before = Date.now();
  const t = new SystemClock().now();
  const after = Date.now();
  assert.ok(t instanceof Timestamp);
  assert.ok(t.epochMs() >= before && t.epochMs() <= after);
});
