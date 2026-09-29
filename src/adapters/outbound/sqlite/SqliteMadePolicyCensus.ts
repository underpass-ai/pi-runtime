import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MadePolicyCensus } from "../../../application/ports/MadePolicyCensus.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";

// Lee el store de MADE en sólo lectura (tabla authorization_policy_state de made-mcp 0.8.0):
// nunca lo crea ni lo modifica; cualquier fallo es "no se sabe".
export class SqliteMadePolicyCensus implements MadePolicyCensus {
  policies(store: StorePath): number | null {
    if (!existsSync(store.value)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(store.value, { readOnly: true });
      db.exec("PRAGMA busy_timeout=2000;");
      return Number((db.prepare("SELECT COUNT(*) AS n FROM authorization_policy_state").get() as { n: number }).n);
    } catch { return null; }
    finally { db?.close(); }
  }
}
