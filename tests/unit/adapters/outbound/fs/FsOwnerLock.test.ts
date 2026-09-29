import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
    const children = Array.from({ length: 8 }, () => spawn(process.execPath, [acquirer, dir, String(startAt)], { stdio: ["pipe", "pipe", "inherit"] }));
    const answers = await Promise.all(children.map((c) => new Promise<{ owned: boolean }>((resolve) => {
      let out = "";
      c.stdout.on("data", (d) => { out += d; if (out.includes("\n")) resolve(JSON.parse(out)); });
    })));
    const exits = children.map((c) => new Promise((r) => c.once("exit", r)));
    for (const c of children) c.stdin.end();
    await Promise.all(exits);
    const owners = answers.filter((a) => a.owned).length;
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

test("una guarda de desalojo abandonada por un proceso muerto (o corrupta) no bloquea para siempre", () => {
  for (const guard of [JSON.stringify({ pid: DEAD_PID, token: "x" }), "garbage"]) {
    const dir = mkdtempSync(join(tmpdir(), "lock-"));
    writeFileSync(join(dir, "host.lock"), JSON.stringify({ pid: DEAD_PID }));
    writeFileSync(join(dir, "host.lock.evict"), guard);
    const a = new FsOwnerLock(dir).acquire();
    assert.equal(a.owned, true);
    if (a.owned) a.release();
    assert.deepEqual(readdirSync(dir), []);
  }
});
