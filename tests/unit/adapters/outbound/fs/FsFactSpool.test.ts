import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsFactSpool } from "../../../../../src/adapters/outbound/fs/FsFactSpool.ts";

const dto = (i: number) => ({ stream: "session" as const, sessionId: "s1", type: "tool.started", typeVersion: 1, about: `a${i}`, occurredAtMs: i, actor: { kind: "agent", id: "pi:1" }, payload: {} });

test("append, readAll en orden, removeFirst y 0600", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "spool-")), "spool");
  const s = new FsFactSpool(dir, 7);
  s.append(dto(1)); s.append(dto(2)); s.append(dto(3));
  assert.equal(statSync(join(dir, "7.jsonl")).mode & 0o777, 0o600);
  assert.deepEqual(s.readAll().map((d) => d.about), ["a1", "a2", "a3"]);
  s.removeFirst(2);
  assert.deepEqual([s.pending(), s.readAll()[0].about], [1, "a3"]);
  s.removeFirst(1);
  assert.equal(existsSync(join(dir, "7.jsonl")), false);
  assert.equal(s.pending(), 0);
});

test("desbordamiento: marca .gap y descarta", () => {
  const dir = mkdtempSync(join(tmpdir(), "spool-"));
  const s = new FsFactSpool(dir, 8, 300);
  s.append(dto(1)); s.append(dto(2)); s.append(dto(3));
  assert.ok(existsSync(join(dir, "8.gap")));
  assert.ok(s.pending() < 3);
});

test("directorio 0700, líneas corruptas se ignoran y removeFirst sobre vacío no falla", async () => {
  const { appendFileSync } = await import("node:fs");
  const dir = join(mkdtempSync(join(tmpdir(), "spool-")), "spool");
  const s = new FsFactSpool(dir, 9);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual([s.readAll(), s.pending()], [[], 0]);
  s.removeFirst(3);
  s.append(dto(1)); appendFileSync(join(dir, "9.jsonl"), "{roto\n\n"); s.append(dto(2));
  assert.deepEqual(s.readAll().map((d) => d.about), ["a1", "a2"]);
  s.removeFirst(1);
  assert.equal(statSync(join(dir, "9.jsonl")).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dir, "9.gap")), false);
});
