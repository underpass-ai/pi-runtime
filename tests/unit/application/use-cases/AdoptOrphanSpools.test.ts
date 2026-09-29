import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import type { FactDto } from "../../../../src/application/dto/FactDto.ts";
import type { OrphanSpoolSource } from "../../../../src/application/ports/OrphanSpoolSource.ts";
import { AdoptOrphanSpools } from "../../../../src/application/use-cases/AdoptOrphanSpools.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { SESSION } from "../../../support/recordFixtures.ts";
import { FixedClock } from "../../../support/FixedClock.ts";

const dto = (type: string, about: string, extra: Partial<FactDto> = {}) => ({ stream: "session", sessionId: "s1", type, typeVersion: 1, about, occurredAtMs: 1000, actor: { kind: "agent", id: "pi:1" }, payload: {}, ...extra }) as FactDto;

class MemSource implements OrphanSpoolSource {
  files = new Map<string, { facts: FactDto[]; unreadable: number }>(); released: string[] = [];
  claim(): string[] { return [...this.files.keys()]; }
  read(claim: string) { return this.files.get(claim)!; }
  release(claim: string): void { this.files.delete(claim); this.released.push(claim); }
}

test("adopta los spools huérfanos: registra en orden, cuenta los inválidos y libera el fichero", () => {
  const store = new InMemoryEventStore(); const source = new MemSource();
  source.files.set("41.jsonl.draining", { facts: [dto("session.opened", "o"), dto("turn.completed", "t1"), dto("turn.completed", "bad", { occurredAtMs: -1 }), dto("turn.completed", "t2")], unreadable: 1 });
  const r = new AdoptOrphanSpools(source, new RecordFact(store, new FixedClock(5000))).execute();
  assert.deepEqual(r, { files: 1, recorded: 3, invalid: 2, retained: 0 });
  assert.deepEqual(store.readStream(SESSION).map((e) => e.type.value), ["session.opened", "turn.completed", "turn.completed"]);
  assert.deepEqual(source.released, ["41.jsonl.draining"]);
});

test("un hecho ya registrado (reenvío tras un drain a medias) es idempotente, no inválido", () => {
  const store = new InMemoryEventStore(); const record = new RecordFact(store, new FixedClock(5000)); const source = new MemSource();
  source.files.set("a", { facts: [dto("session.opened", "o")], unreadable: 0 });
  new AdoptOrphanSpools(source, record).execute();
  source.files.set("b", { facts: [dto("session.opened", "o"), dto("turn.completed", "t")], unreadable: 0 });
  assert.deepEqual(new AdoptOrphanSpools(source, record).execute(), { files: 1, recorded: 2, invalid: 0, retained: 0 });
  assert.equal(store.readStream(SESSION).length, 2);
});

test("un fallo que no es del hecho (log no disponible) conserva el fichero reclamado para el siguiente intento", () => {
  const source = new MemSource();
  source.files.set("a", { facts: [dto("session.opened", "o")], unreadable: 0 });
  source.files.set("b", { facts: [dto("session.opened", "o2", { sessionId: "s2" })], unreadable: 0 });
  const broken = { execute: () => { throw new Error("database is locked"); } };
  assert.deepEqual(new AdoptOrphanSpools(source, broken as never).execute(), { files: 2, recorded: 0, invalid: 0, retained: 2 });
  assert.deepEqual([source.released, [...source.files.keys()]], [[], ["a", "b"]]);
});

test("sin huérfanos no hace nada", () => {
  assert.deepEqual(new AdoptOrphanSpools(new MemSource(), new RecordFact(new InMemoryEventStore(), new FixedClock())).execute(), { files: 0, recorded: 0, invalid: 0, retained: 0 });
});
