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

test("mientras hay pendientes los nuevos hechos esperan en el spool y salen detrás de los viejos", async () => {
  const spool = new MemSpool(); spool.append(dto("old")); const sent: string[] = []; const appended: string[] = [];
  const append = spool.append.bind(spool); spool.append = (f: FactDto) => { appended.push(f.about); append(f); };
  const sink = new HostFactSink(async () => ({ record: async (f: FactDto) => { sent.push(f.about); } }) as never, spool as never);
  sink.record(dto("new"));
  assert.deepEqual([sent, appended], [[], ["new"]]); // no va directo: espera en el spool
  await sink.flush();
  assert.deepEqual([sent, spool.pending()], [["old", "new"], 0]);
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

test("el host vuelve sin HOST_READY: el siguiente hecho dispara el reenvío en orden y sin duplicados", async () => {
  const spool = new MemSpool(); let up = false; const sent: string[] = [];
  const gateway = async () => {
    if (!up) throw new HostCallError("transport", "down");
    return { record: async (f: FactDto) => { sent.push(f.about); } } as never;
  };
  const sink = new HostFactSink(gateway, spool as never);
  sink.record(dto("a")); await tick(); sink.record(dto("b")); await tick();
  assert.deepEqual([sent, spool.pending()], [[], 2]);
  up = true;
  sink.record(dto("c")); await tick();
  assert.deepEqual([sent, spool.pending()], [["a", "b", "c"], 0]);
  sink.record(dto("d")); await tick();
  assert.deepEqual(sent, ["a", "b", "c", "d"]);
});

test("flush espera a los envíos directos en vuelo; si fallan por transporte se reenvían en el mismo flush", async () => {
  const spool = new MemSpool(); const sent: string[] = []; let failFirst = true;
  const gateway = async () => ({ record: async (f: FactDto) => {
    await new Promise((r) => setTimeout(r, 10));
    if (failFirst) { failFirst = false; throw new HostCallError("transport", "host connection closed"); }
    sent.push(f.about);
  } }) as never;
  const sink = new HostFactSink(gateway, spool as never);
  sink.record(dto("closed"));
  await sink.flush();
  assert.deepEqual([sent, spool.pending()], [["closed"], 0]);
});

test("un spool que no se puede escribir ni leer nunca lanza hacia Pi ni deja promesas rechazadas", async () => {
  const unhandled: unknown[] = []; const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const broken = { append: () => { throw new Error("ENOSPC"); }, readAll: () => { throw new Error("EACCES"); }, removeFirst: () => { throw new Error("EACCES"); }, pending: () => { throw new Error("EACCES"); } };
    const sink = new HostFactSink(async () => { throw new HostCallError("transport", "down"); }, broken as never);
    assert.doesNotThrow(() => sink.record(dto("a")));
    await tick();
    await sink.flush();
    const full = { append: () => { throw new Error("ENOSPC"); }, readAll: () => [], removeFirst: () => {}, pending: () => 0 };
    const sink2 = new HostFactSink(async () => { throw new HostCallError("transport", "down"); }, full as never);
    sink2.record(dto("b")); await tick();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled, []);
  } finally { process.off("unhandledRejection", onUnhandled); }
});
