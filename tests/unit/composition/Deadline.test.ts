import { test } from "node:test";
import assert from "node:assert/strict";
import { Deadline } from "../../../src/composition/Deadline.ts";

test("Deadline.within: una exportación final que no termina (o falla) no retiene el apagado", async () => {
  const started = Date.now();
  assert.equal(await Deadline.within(new Promise<void>(() => {}), 30), false);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await Deadline.within(Promise.reject(new Error("boom")), 1000), true);
  assert.equal(await Deadline.within(Promise.resolve(), 1000), true);
});
