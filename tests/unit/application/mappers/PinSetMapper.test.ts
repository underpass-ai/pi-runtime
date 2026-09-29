import { test } from "node:test";
import assert from "node:assert/strict";
import { PinSetMapper } from "../../../../src/application/mappers/PinSetMapper.ts";
import { BinaryName } from "../../../../src/domain/distribution/BinaryName.ts";
import { JsonPinSetSource } from "../../../../src/adapters/outbound/fs/JsonPinSetSource.ts";

test("el pins.json del repo produce un PinSet válido", () => {
  const set = new JsonPinSetSource(new URL("../../../../pins.json", import.meta.url).pathname).load();
  assert.equal(set.pinFor(BinaryName.MADE).version.value, "0.8.0");
  assert.equal(set.pi.integrity.value.startsWith("sha512-"), true);
});

test("el mapper propaga el error de dominio de un DTO corrupto", () => {
  assert.throws(() => new PinSetMapper().toDomain({ pi: { package: "x", version: "1", integrity: "y" }, binaries: [] }));
});
