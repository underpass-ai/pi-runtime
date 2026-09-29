import { test } from "node:test";
import assert from "node:assert/strict";
import type { FactDto } from "../../../../src/application/dto/FactDto.ts";
import type { OrphanSpoolSource } from "../../../../src/application/ports/OrphanSpoolSource.ts";
import { OrphanSpoolAdoption } from "../../../../src/application/services/OrphanSpoolAdoption.ts";
import { SpoolRetryBackoff } from "../../../../src/application/services/SpoolRetryBackoff.ts";
import { AdoptOrphanSpools } from "../../../../src/application/use-cases/AdoptOrphanSpools.ts";
import type { Fact } from "../../../../src/domain/events/Fact.ts";
import { FixedClock } from "../../../support/FixedClock.ts";

const dto = (sessionId: string) => ({ stream: "session", sessionId, type: "session.opened", typeVersion: 1, about: "o", occurredAtMs: 1000, actor: { kind: "agent", id: "pi:1" }, payload: {} }) as FactDto;

class MemSource implements OrphanSpoolSource {
  files = new Map<string, FactDto[]>(); reads: string[] = []; failClaim: string | null = null;
  claim(): string[] { if (this.failClaim) throw new Error(this.failClaim); return [...this.files.keys()].sort(); }
  read(claim: string) { this.reads.push(claim); return { facts: this.files.get(claim)!, unreadable: 0 }; }
  release(claim: string): void { this.files.delete(claim); }
}

// Registro que falla para los hechos de las sesiones que están en `broken`.
function setup() {
  const source = new MemSource(); const broken = new Set<string>(); const clock = new FixedClock(0); const log: string[] = []; const levels: string[] = [];
  const record = { execute: (f: Fact) => { if (broken.has(f.stream.sessionId().value)) throw new Error("database is locked"); } };
  const adoption = new OrphanSpoolAdoption(new AdoptOrphanSpools(source, record as never), clock, (level, l) => { levels.push(level); log.push(l); });
  const at = (ms: number) => { clock.ms = ms; adoption.tick(); };
  return { source, broken, log, levels, at };
}

test("el retroceso por fichero empieza en 5 s, se dobla y se topa en 5 min", () => {
  let b = SpoolRetryBackoff.first(0);
  const delays: number[] = [];
  for (let i = 0; i < 9; i++) { delays.push(b.nextAttemptMs() - b.failedAtMs()); b = b.failedAgain(b.nextAttemptMs()); }
  assert.deepEqual(delays, [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  assert.equal(SpoolRetryBackoff.first(0).isDue(4_999), false);
  assert.equal(SpoolRetryBackoff.first(0).isDue(5_000), true);
  assert.equal(SpoolRetryBackoff.first(0).failures(), 1);
});

test("un .draining que falla se reintenta con retroceso exponencial y sólo se registra al fallar la primera vez y al recuperarse", () => {
  const { source, broken, log, levels, at } = setup();
  source.files.set("7.jsonl.draining", [dto("a")]); broken.add("a");
  at(0);
  assert.equal(source.reads.length, 1);
  assert.deepEqual(levels, ["warn"], "retenido es un aviso");
  assert.equal(log.length, 1);
  assert.match(log[0], /^fact spool: 7\.jsonl\.draining retained \(database is locked\); retrying with backoff from 5s up to 5min$/);
  for (const [ms, attempted] of [[4_999, 1], [5_000, 2], [14_999, 2], [15_000, 3], [34_999, 3], [35_000, 4]] as const) {
    at(ms);
    assert.equal(source.reads.length, attempted, `t=${ms}`);
  }
  assert.equal(log.length, 1, "los fallos repetidos no se registran");
  broken.clear();
  at(74_999); assert.equal(source.reads.length, 4);
  at(75_000);
  assert.equal(source.files.size, 0);
  assert.deepEqual(log.slice(1), ["fact spool: 7.jsonl.draining adopted after 4 failed attempt(s)", "fact spool: adopted 1 orphan spool(s): 1 recorded, 0 invalid"]);
  assert.deepEqual(levels, ["warn", "info", "info"], "la recuperación y la adopción son info");
  at(80_000);
  assert.equal(log.length, 3);
});

test("el retroceso es por fichero: otro huérfano se adopta enseguida y el éxito reinicia el retroceso", () => {
  const { source, broken, log, at } = setup();
  source.files.set("7.jsonl.draining", [dto("a")]); broken.add("a");
  at(0);
  source.files.set("8.jsonl.draining", [dto("b")]);
  at(1_000);
  assert.deepEqual(source.reads, ["7.jsonl.draining", "8.jsonl.draining"]);
  assert.equal(log[1], "fact spool: adopted 1 orphan spool(s): 1 recorded, 0 invalid");
  broken.clear(); at(5_000);
  // Si vuelve a aparecer un fichero con el mismo nombre y falla, empieza de nuevo por 5 s.
  source.files.set("7.jsonl.draining", [dto("a")]); broken.add("a");
  at(6_000);
  assert.match(log.at(-1)!, /7\.jsonl\.draining retained/);
  at(10_999); assert.equal(source.reads.filter((r) => r === "7.jsonl.draining").length, 3);
  at(11_000); assert.equal(source.reads.filter((r) => r === "7.jsonl.draining").length, 4);
});

test("un fichero que desaparece mientras espera se olvida", () => {
  const { source, broken, log, at } = setup();
  source.files.set("7.jsonl.draining", [dto("a")]); broken.add("a");
  at(0);
  source.files.delete("7.jsonl.draining");
  at(5_000);
  source.files.set("7.jsonl.draining", [dto("a")]);
  at(5_001);
  assert.equal(source.reads.length, 2, "reaparece sin retroceso pendiente");
  assert.equal(log.length, 2, "el primer fallo vuelve a registrarse");
});

test("un fallo al reclamar se registra una vez por cambio de estado, no en cada tick", () => {
  const { source, log, levels, at } = setup();
  source.failClaim = "EACCES: permission denied";
  at(0); at(5_000); at(10_000);
  assert.deepEqual(log, ["fact spool: EACCES: permission denied"]);
  source.failClaim = null;
  at(15_000);
  assert.deepEqual(log, ["fact spool: EACCES: permission denied", "fact spool: orphan adoption recovered"]);
  assert.deepEqual(levels, ["warn", "info"], "el fallo al reclamar es un aviso; la recuperación, info");
  source.failClaim = "EACCES: permission denied";
  at(20_000);
  assert.equal(log.length, 3);
});
