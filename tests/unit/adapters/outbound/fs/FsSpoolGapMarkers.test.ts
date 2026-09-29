import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsSpoolGapMarkers } from "../../../../../src/adapters/outbound/fs/FsSpoolGapMarkers.ts";

test("lista sólo los marcadores .gap (ordenados) y los borra al reconocerlos, sin tocar el resto del spool", () => {
  const dir = mkdtempSync(join(tmpdir(), "spool-gaps-"));
  writeFileSync(join(dir, "9.gap"), ""); writeFileSync(join(dir, "3.gap"), ""); writeFileSync(join(dir, "3.jsonl"), "{}\n"); writeFileSync(join(dir, "4.jsonl.draining"), "{}\n");
  const markers = new FsSpoolGapMarkers(dir);
  assert.deepEqual(markers.list(), ["3.gap", "9.gap"]);
  markers.remove("3.gap");
  assert.deepEqual(readdirSync(dir).sort(), ["3.jsonl", "4.jsonl.draining", "9.gap"]);
  markers.remove("3.gap"); // ya no está: no falla
});

test("sin directorio de spool no hay marcadores y no lo crea", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "spool-gaps-")), "spool");
  assert.deepEqual(new FsSpoolGapMarkers(dir).list(), []);
  assert.equal(existsSync(dir), false);
});

test("un nombre que no es un marcador .gap del spool se rechaza", () => {
  const dir = mkdtempSync(join(tmpdir(), "spool-gaps-"));
  writeFileSync(join(dir, "3.jsonl"), "{}\n");
  assert.throws(() => new FsSpoolGapMarkers(dir).remove("3.jsonl"), /not a spool gap marker/);
  assert.throws(() => new FsSpoolGapMarkers(dir).remove("../x.gap"), /not a spool gap marker/);
  assert.ok(existsSync(join(dir, "3.jsonl")));
});
