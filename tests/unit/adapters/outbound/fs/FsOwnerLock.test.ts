import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsOwnerLock } from "../../../../../src/adapters/outbound/fs/FsOwnerLock.ts";

test("propietario único; el segundo ve el pid; liberar permite retomarlo", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  const a = new FsOwnerLock(dir).acquire();
  assert.equal(a.owned, true);
  assert.deepEqual(new FsOwnerLock(dir).acquire(), { owned: false, ownerPid: process.pid });
  if (a.owned) a.release();
  assert.equal(new FsOwnerLock(dir).acquire().owned, true);
});

test("un lock de un proceso muerto o corrupto se recupera", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  writeFileSync(join(dir, "host.lock"), JSON.stringify({ pid: 2 ** 22 + 12345 }));
  assert.equal(new FsOwnerLock(dir).acquire().owned, true);
  const dir2 = mkdtempSync(join(tmpdir(), "lock-"));
  writeFileSync(join(dir2, "host.lock"), "garbage");
  assert.equal(new FsOwnerLock(dir2).acquire().owned, true);
});
