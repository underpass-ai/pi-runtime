import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import { StreamVerifier } from "../../domain/events/StreamVerifier.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import type { SpoolInspector } from "../ports/SpoolInspector.ts";

const S = CheckSection.EVENTS;
const ok = (n: string, d: string) => Check.ok(S, CheckName.of(n), CheckDetail.of(d));
const warn = (n: string, d: string) => Check.warn(S, CheckName.of(n), CheckDetail.of(d));
const fail = (n: string, d: string) => Check.fail(S, CheckName.of(n), CheckDetail.of(d));

export class DiagnoseEventLog {
  readonly #events: EventStore; readonly #projections: ProjectionStore; readonly #list: Projection[]; readonly #spool: SpoolInspector;
  constructor(events: EventStore, projections: ProjectionStore, list: Projection[], spool: SpoolInspector) { this.#events = events; this.#projections = projections; this.#list = list; this.#spool = spool; }

  execute(): Check[] {
    const last = this.#events.lastPosition().value; const streams = this.#events.streams();
    const checks: Check[] = [last === 0 ? warn("event log", "no events recorded yet") : ok("event log", `${last} events, ${streams.length} streams`)];
    const broken = streams.map((s) => ({ s, r: StreamVerifier.verify(this.#events.readStream(s)) })).find((x) => x.r.kind === "broken");
    checks.push(broken ? fail("event chain", `${broken.s.value} broken at v${broken.r.version?.value}: ${broken.r.reason}`) : ok("event chain", "all streams intact"));
    const behind = this.#list.map((p) => {
      const c = this.#projections.cursor(p.name);
      if (c === null || c.version !== p.version) return `${p.name.value} version mismatch`;
      return c.position.value < last ? `${p.name.value} at ${c.position.value}/${last} (behind)` : null;
    }).filter((x): x is string => x !== null);
    checks.push(behind.length === 0 ? ok("projections", "up to date") : warn("projections", behind.join("; ")));
    const quarantined = this.#list.reduce((n, p) => n + this.#projections.quarantined(p.name).length, 0);
    checks.push(quarantined === 0 ? ok("projection quarantine", "empty") : warn("projection quarantine", `${quarantined} quarantined events`));
    const sp = this.#spool.inspect();
    checks.push(sp.gaps > 0 ? fail("fact spool", `${sp.gaps} spool overflow gap(s): facts were lost`)
      : sp.pendingFiles > 0 ? warn("fact spool", `${sp.pendingFiles} pending spool file(s)`) : ok("fact spool", "empty"));
    return checks;
  }
}
