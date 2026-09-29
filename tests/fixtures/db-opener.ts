#!/usr/bin/env node
// Uso: node db-opener.ts <db>. Abre la base (creando el fichero si no existe) y hace una escritura trivial en transacción.
import { SqliteDatabase } from "../../src/adapters/outbound/sqlite/SqliteDatabase.ts";

const [path] = process.argv.slice(2);
const db = SqliteDatabase.open(path);
db.transaction(() => { db.handle.exec("INSERT OR IGNORE INTO meta(key, value) VALUES ('probe', '1')"); });
db.close();
