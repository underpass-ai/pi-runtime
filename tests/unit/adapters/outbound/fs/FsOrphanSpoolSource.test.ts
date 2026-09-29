import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsOrphanSpoolSource } from "../../../../../src/adapters/outbound/fs/FsOrphanSpoolSource.ts";

const line = (about: string) => `${JSON.stringify({ stream: "session", sessionId: "s1", type: "turn.completed", typeVersion: 1, about, occurredAtMs: 1, actor: { kind: "agent", id: "pi:1" }, payload: {} })}\n`;

test("reclama por rename sólo los spools de pids muertos y recoge los .draining que quedaron a medias", () => {
  const dir = mkdtempSync(join(tmpdir(), "orphan-"));
  writeFileSync(join(dir, "100.jsonl"), line("a") + "{roto\n" + line("b"));   // muerto
  writeFileSync(join(dir, "200.jsonl"), line("vivo"));                        // vivo: no se toca
  writeFileSync(join(dir, "300.jsonl.draining"), line("c"));                  // un host murió drenándolo
  writeFileSync(join(dir, "100.jsonl.tmp"), line("a"));                       // resto de un removeFirst cortado
  writeFileSync(join(dir, "100.gap"), "");                                    // el hueco se conserva para doctor
  const source = new FsOrphanSpoolSource(dir, (pid) => pid === 200);
  const claims = source.claim().sort();
  assert.deepEqual(claims, ["100.jsonl.draining", "300.jsonl.draining"]);
  assert.deepEqual(readdirSync(dir).sort(), ["100.gap", "100.jsonl.draining", "200.jsonl", "300.jsonl.draining"]);
  const read = source.read("100.jsonl.draining");
  assert.deepEqual([read.facts.map((f) => f.about), read.unreadable], [["a", "b"], 1]);
  source.release("100.jsonl.draining"); source.release("300.jsonl.draining");
  assert.deepEqual(readdirSync(dir).sort(), ["100.gap", "200.jsonl"]);
});

test("sin directorio de spool no hay nada que reclamar; un claim desaparecido se lee vacío", () => {
  const source = new FsOrphanSpoolSource(join(tmpdir(), "no-existe-orphan"), () => false);
  assert.deepEqual(source.claim(), []);
  assert.deepEqual(source.read("9.jsonl.draining"), { facts: [], unreadable: 0 });
  assert.doesNotThrow(() => source.release("9.jsonl.draining"));
});

test("la vivacidad por defecto usa process.kill(pid, 0): el propio proceso está vivo, un pid inexistente no", () => {
  const dir = mkdtempSync(join(tmpdir(), "orphan-"));
  writeFileSync(join(dir, `${process.pid}.jsonl`), line("yo"));
  writeFileSync(join(dir, "2147483646.jsonl"), line("nadie"));
  assert.deepEqual(new FsOrphanSpoolSource(dir).claim(), ["2147483646.jsonl.draining"]);
  assert.ok(existsSync(join(dir, `${process.pid}.jsonl`)));
});
