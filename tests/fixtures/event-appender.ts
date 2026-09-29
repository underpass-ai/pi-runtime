#!/usr/bin/env node
// Uso: node event-appender.ts <db> <prefix> <n>. Añade n hechos al stream de la sesión s1 y reintenta ante conflicto.
import { SqliteDatabase } from "../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { Appended } from "../../src/domain/events/Appended.ts";
import { StreamVersion } from "../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../support/recordFixtures.ts";

const [path, prefix, n] = process.argv.slice(2);
const store = new SqliteEventStore(SqliteDatabase.open(path));
for (let i = 0; i < Number(n); i++) {
  for (;;) {
    const head = store.head(SESSION);
    const f = head === null ? fact("session.opened", `${prefix}.open`) : fact("turn.completed", `${prefix}.${i}`);
    const out = store.append(SESSION, head?.version ?? StreamVersion.NONE, [f], AT);
    if (out instanceof Appended) break;
  }
}
