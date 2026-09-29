import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { MadePolicyCensus } from "../ports/MadePolicyCensus.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";
import { MadeOwner } from "../services/MadeOwner.ts";

const S = CheckSection.MADE_AUTH;
const check = (kind: "ok" | "warn" | "fail", name: string, detail: string) => Check[kind](S, CheckName.of(name), CheckDetail.of(detail));

// Sección [made-auth] de doctor (S3a §5). Nunca emite nada ni lanza:
// - host authorization: el host puede leer la política como dueño (sólo lectura);
// - orphan grants: WARN si hay grants del host vigentes cuya sesión ya cerró o se abandonó;
// - shared store: WARN informativo si otro cliente de MADE usa el store (grants que no emitió
//   pi-runtime, o más de una política) o si aún no tiene política.
export class DiagnoseMadeAuthorization {
  readonly #events: EventStore; readonly #census: MadePolicyCensus; readonly #store: StorePath; readonly #clock: Clock;
  constructor(events: EventStore, census: MadePolicyCensus, store: StorePath, clock: Clock) { this.#events = events; this.#census = census; this.#store = store; this.#clock = clock; }

  async execute(connection: McpConnection | null): Promise<Check[]> {
    const checks: Check[] = [];
    if (connection !== null) {
      try { await new MadeOwner(async () => connection).principal(); checks.push(check("ok", "host authorization", "the host owns the MADE policy and can grant exact actions")); }
      catch (e) { checks.push(check("fail", "host authorization", `cannot read the MADE policy as its owner (${e instanceof ToolRefusal ? e.code.value : (e as Error).name}); run underpass setup`)); }
    }
    try {
      const now = this.#clock.now();
      const valid = MadeGrantLedger.read(this.#events).orphans(now).filter((o) => !o.grant.expired(now)).length;
      checks.push(valid === 0 ? check("ok", "orphan grants", "none")
        : check("warn", "orphan grants", `${valid} host grants still valid after their session ended; run underpass made revoke-orphans`));
    } catch (e) { checks.push(check("warn", "orphan grants", `event log unreadable (${(e as Error).name})`)); }
    const census = this.#census.census(this.#store);
    if (census !== null) checks.push(DiagnoseMadeAuthorization.#shared(census.policies, census.foreignGrants));
    return checks;
  }

  // Con los valores por defecto, pi-runtime y el plugin de Claude Code comparten store y
  // configuración, así que también la política: el censo de políticas no lo ve. Lo delatan los
  // grants que no emitió pi-runtime. Un cliente que nunca emitió ninguno no deja rastro: por eso
  // el OK lo dice.
  static #shared(policies: number, foreignGrants: number): Check {
    if (foreignGrants > 0) return check("warn", "shared store", `${foreignGrants} MADE grants in this store were not issued by pi-runtime: another MADE client (e.g. the Claude Code plugin) acts as the same principal`);
    if (policies > 1) return check("warn", "shared store", `the MADE store holds ${policies} authorization policies; another installation (e.g. the Claude Code plugin) shares it`);
    if (policies === 0) return check("warn", "shared store", "the MADE store has no authorization policy yet; run underpass setup");
    return check("ok", "shared store", "no other MADE client has issued grants in this store; any client that opens it (e.g. the Claude Code plugin) acts as the same principal");
  }
}
