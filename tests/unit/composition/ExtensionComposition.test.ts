import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsFactSpool } from "../../../src/adapters/outbound/fs/FsFactSpool.ts";
import type { FactDto } from "../../../src/application/dto/FactDto.ts";
import { ExtensionComposition } from "../../../src/composition/ExtensionComposition.ts";

const fact = (n: number) => ({ stream: "session", sessionId: "s", type: "turn.completed", typeVersion: 1, about: `t${n}`, occurredAtMs: n, actor: { kind: "agent", id: "a" }, payload: {} }) as FactDto;

test("un único sink por proceso y spool: el mismo directorio y pid dan la misma instancia", () => {
  const dir = mkdtempSync(join(tmpdir(), "sink-"));
  const gw = async () => { throw new Error("down"); };
  const a = ExtensionComposition.factSink(dir, 101, gw as never);
  assert.equal(ExtensionComposition.factSink(dir, 101, gw as never), a);
  assert.notEqual(ExtensionComposition.factSink(dir, 102, gw as never), a);
  assert.notEqual(ExtensionComposition.factSink(join(dir, "otro"), 101, gw as never), a);
});

// /new durante un drain: la sesión nueva pide su sink mientras el drain de la
// anterior sigue en vuelo. Antes cada session_start creaba un HostFactSink y
// un FsFactSpool nuevos sobre el mismo <pid>.jsonl, los dos drains borraban
// del mismo fichero y se perdían hechos no entregados.
test("/new durante un drain: los drains se serializan y no se pierde ningún hecho", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sink-"));
  const seed = new FsFactSpool(dir, 103); for (const n of [1, 2, 3]) seed.append(fact(n));
  const received: string[] = [];
  // El host confirma t1 y muere: rechaza todo lo demás por transporte.
  const gw = async () => ({ record: async (f: FactDto) => { if (f.about === "t1") { received.push(f.about); return; } throw new Error("transport"); } });
  const sinkA = ExtensionComposition.factSink(dir, 103, gw as never);
  const pA = sinkA.flush();
  const sinkB = ExtensionComposition.factSink(dir, 103, gw as never);
  const pB = sinkB.flush();
  await Promise.all([pA, pB]);
  assert.deepEqual(received, ["t1"]);
  assert.deepEqual(new FsFactSpool(dir, 103).readAll().map((f) => f.about), ["t2", "t3"]);
});
