import { test } from "node:test";
import assert from "node:assert/strict";
import { HostFactSink } from "../../../../../src/adapters/outbound/ipc/HostFactSink.ts";
import { HostCallError } from "../../../../../src/application/ports/HostCallError.ts";
import type { FactDto } from "../../../../../src/application/dto/FactDto.ts";

class MemSpool { items: FactDto[] = []; append(f: FactDto) { this.items.push(f); } readAll() { return [...this.items]; } removeFirst(n: number) { this.items.splice(0, n); } pending() { return this.items.length; } }
const dto = (about: string) => ({ stream: "session", sessionId: "s1", type: "tool.started", typeVersion: 1, about, occurredAtMs: 1, actor: { kind: "agent", id: "pi:1" }, payload: {} }) as FactDto;
const tick = () => new Promise((r) => setTimeout(r, 5));

test("host caído: al spool; al volver, flush en orden, sin duplicados, y los inválidos se descartan", async () => {
  const spool = new MemSpool(); let up = false; const sent: string[] = [];
  const gateway = async () => {
    if (!up) throw new HostCallError("transport", "down");
    return { record: async (f: FactDto) => { if (f.about === "bad") throw new HostCallError("invalid", "nope"); sent.push(f.about); } } as never;
  };
  const sink = new HostFactSink(gateway, spool as never);
  sink.record(dto("a")); await tick(); sink.record(dto("bad")); await tick(); sink.record(dto("b")); await tick();
  assert.deepEqual(spool.items.map((f) => f.about), ["a", "bad", "b"]);
  up = true;
  await sink.flush();
  assert.deepEqual([sent, spool.pending()], [["a", "b"], 0]);
  sink.record(dto("c")); await tick();
  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("mientras hay pendientes los nuevos hechos esperan en el spool", async () => {
  const spool = new MemSpool(); spool.append(dto("old")); const sent: string[] = [];
  const sink = new HostFactSink(async () => ({ record: async (f: FactDto) => { sent.push(f.about); } }) as never, spool as never);
  sink.record(dto("new")); await tick();
  assert.deepEqual(sent, []);
  await sink.flush();
  assert.deepEqual(sent, ["old", "new"]);
});

test("flush con el host caído conserva el spool; un fallo a mitad deja sólo lo no entregado; flush concurrente se comparte", async () => {
  const spool = new MemSpool(); spool.append(dto("a")); spool.append(dto("b")); spool.append(dto("c"));
  let mode = "down"; const sent: string[] = [];
  const gateway = async () => {
    if (mode === "down") throw new Error("Underpass host not connected yet");
    return { record: async (f: FactDto) => { if (mode === "flaky" && f.about === "b") throw new HostCallError("transport", "closed"); sent.push(f.about); } } as never;
  };
  const sink = new HostFactSink(gateway, spool as never);
  await sink.flush();
  assert.equal(spool.pending(), 3);
  mode = "flaky";
  await sink.flush();
  assert.deepEqual([sent, spool.items.map((f) => f.about)], [["a"], ["b", "c"]]);
  mode = "up";
  const [p1, p2] = [sink.flush(), sink.flush()];
  assert.equal(p1, p2);
  sink.record(dto("d")); // flush en curso: al spool y se entrega en la misma vuelta
  await p1;
  assert.deepEqual([sent, spool.pending()], [["a", "b", "c", "d"], 0]);
});

test("record directo: un error de transporte guarda el hecho en el spool", async () => {
  const spool = new MemSpool();
  const sink = new HostFactSink(async () => ({ record: async () => { throw new HostCallError("transport", "closed"); } }) as never, spool as never);
  sink.record(dto("x")); await tick();
  assert.deepEqual(spool.items.map((f) => f.about), ["x"]);
});
