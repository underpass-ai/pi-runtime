import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsSpoolInspector } from "../../../../../src/adapters/outbound/fs/FsSpoolInspector.ts";

test("cuenta los .jsonl no vacíos y los .gap", () => {
  const dir = mkdtempSync(join(tmpdir(), "spool-inspect-"));
  writeFileSync(join(dir, "1.jsonl"), "{}\n"); writeFileSync(join(dir, "2.jsonl"), ""); writeFileSync(join(dir, "3.gap"), "");
  writeFileSync(join(dir, "notes.txt"), "x");
  assert.deepEqual(new FsSpoolInspector(dir).inspect(), { pendingFiles: 1, gaps: 1 });
});

test("un directorio inexistente no tiene nada pendiente", () => {
  assert.deepEqual(new FsSpoolInspector(join(tmpdir(), "no-such-spool-dir-e1", "spool")).inspect(), { pendingFiles: 0, gaps: 0 });
});
