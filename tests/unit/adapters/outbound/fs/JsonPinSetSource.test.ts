import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonPinSetSource } from "../../../../../src/adapters/outbound/fs/JsonPinSetSource.ts";
import { BinaryName } from "../../../../../src/domain/distribution/BinaryName.ts";

test("carga y mapea el pins.json real del repo", () => {
  const path = new URL("../../../../../pins.json", import.meta.url).pathname;
  const set = new JsonPinSetSource(path).load();
  assert.equal(set.pinFor(BinaryName.KMP).version.value, "0.24.0");
  assert.equal(set.pi.packageName.value, "@earendil-works/pi-coding-agent");
});

test("propaga el error si el fichero no existe", () => {
  assert.throws(() => new JsonPinSetSource("/no/existe/pins.json").load());
});
