import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
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

const acquirer = new URL("../../../../fixtures/lock-acquirer.ts", import.meta.url).pathname;
const DEAD_PID = 2 ** 22 + 12345;

test("varios procesos que compiten por un lock huérfano: exactamente uno se queda con él", async () => {
  for (let round = 0; round < 4; round++) {
    const dir = mkdtempSync(join(tmpdir(), "lock-race-"));
    writeFileSync(join(dir, "host.lock"), JSON.stringify({ pid: DEAD_PID }));
    const startAt = Date.now() + 400;
    const outs = await Promise.all(Array.from({ length: 8 }, () => promisify(execFile)(process.execPath, [acquirer, dir, String(startAt), "800"])));
    const owners = outs.filter(({ stdout }) => JSON.parse(stdout).owned).length;
    assert.equal(owners, 1, `ronda ${round}: ${owners} dueños`);
    assert.deepEqual(readdirSync(dir), [], "no quedan temporales ni el lock tras liberar");
  }
});

test("release() de quien ya no es dueño no borra el lock ajeno", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  const a = new FsOwnerLock(dir).acquire();
  assert.equal(a.owned, true);
  const other = JSON.stringify({ pid: 1, token: "otro-host" });
  writeFileSync(join(dir, "host.lock"), other);
  if (a.owned) a.release();
  assert.equal(existsSync(join(dir, "host.lock")), true);
  assert.equal(readFileSync(join(dir, "host.lock"), "utf8"), other);
});

test("el lock guarda el pid del dueño y no deja temporales", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  const a = new FsOwnerLock(dir).acquire();
  assert.equal(JSON.parse(readFileSync(join(dir, "host.lock"), "utf8")).pid, process.pid);
  assert.deepEqual(readdirSync(dir), ["host.lock"]);
  if (a.owned) a.release();
  assert.deepEqual(readdirSync(dir), []);
});
