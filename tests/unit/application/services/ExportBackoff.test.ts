import { test } from "node:test";
import assert from "node:assert/strict";
import { ExportBackoff } from "../../../../src/application/services/ExportBackoff.ts";

test("retroceso de exportación: 1 s, doblando en cada fallo seguido, con tope de 5 min", () => {
  let b = ExportBackoff.first(1000);
  assert.deepEqual([b.failures(), b.nextAttemptMs(), b.isDue(1999), b.isDue(2000)], [1, 2000, false, true]);
  b = b.failedAgain(2000);
  assert.deepEqual([b.failures(), b.nextAttemptMs()], [2, 4000]);
  for (let i = 0; i < 20; i++) b = b.failedAgain(10_000);
  assert.equal(b.nextAttemptMs(), 10_000 + 300_000);
});
