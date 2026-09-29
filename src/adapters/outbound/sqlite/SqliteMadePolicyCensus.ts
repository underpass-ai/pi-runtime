import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MadeStoreCensusDto } from "../../../application/dto/MadeStoreCensusDto.ts";
import type { MadePolicyCensus } from "../../../application/ports/MadePolicyCensus.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";

const OURS = "pi-runtime-";

// Lee el store de MADE en sólo lectura (tabla authorization_policy_state de made-mcp 0.8.0, cuyo
// payload es el JSON con los eventos de cada política): nunca lo crea ni lo modifica; cualquier
// fallo es "no se sabe". Un payload ilegible cuenta como política sin grants.
export class SqliteMadePolicyCensus implements MadePolicyCensus {
  census(store: StorePath): MadeStoreCensusDto | null {
    if (!existsSync(store.value)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(store.value, { readOnly: true });
      db.exec("PRAGMA busy_timeout=2000;");
      const rows = db.prepare("SELECT payload FROM authorization_policy_state").all() as { payload: Uint8Array }[];
      const foreign = new Set<string>();
      for (const row of rows) for (const id of SqliteMadePolicyCensus.#grantIds(row.payload)) if (!id.startsWith(OURS)) foreign.add(id);
      return { policies: rows.length, foreignGrants: foreign.size };
    } catch { return null; }
    finally { db?.close(); }
  }

  static #grantIds(payload: Uint8Array): string[] {
    try {
      const state = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as { events?: { type?: unknown; grant?: { id?: unknown } }[] };
      return (Array.isArray(state?.events) ? state.events : []).filter((e) => e?.type === "grant_issued" && typeof e.grant?.id === "string").map((e) => e.grant!.id as string);
    } catch { return []; }
  }
}
