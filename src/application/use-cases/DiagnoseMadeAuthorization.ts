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
// - shared store: WARN informativo si el store guarda más de una política.
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
    const policies = this.#census.policies(this.#store);
    if (policies !== null && policies > 1) checks.push(check("warn", "shared store", `the MADE store holds ${policies} authorization policies; another installation (e.g. the Claude Code plugin) shares it`));
    else if (policies !== null) checks.push(check("ok", "shared store", "only pi-runtime's policy"));
    return checks;
  }
}
