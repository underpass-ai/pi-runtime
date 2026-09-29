import type { ListMadeCeremonies } from "../../../application/use-cases/ListMadeCeremonies.ts";
import type { ListMadeGrants } from "../../../application/use-cases/ListMadeGrants.ts";
import type { RevokeMadeGrants } from "../../../application/use-cases/RevokeMadeGrants.ts";

type Deps = { grants: ListMadeGrants; ceremonies?: ListMadeCeremonies | null; revoke: RevokeMadeGrants; print: (s: string) => void };
const USAGE = "usage: underpass made grants | ceremonies | revoke-orphans";

// `underpass made grants` y `underpass made revoke-orphans` (S3a §5); `underpass made ceremonies`
// (F3): las instancias que arrancó cada sesión y los grants del host con alcance a ellas.
export class MadeCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  async run(args: string[]): Promise<number> {
    const d = this.#d;
    if (args.length !== 1) return this.#usage();
    try {
      if (args[0] === "grants") {
        const rows = d.grants.execute();
        if (rows.length === 0) { d.print("no MADE grants issued by the host"); return 0; }
        for (const r of rows) d.print(`${r.grantId}  ${(r.reason === null || r.reason === undefined ? r.state : `${r.state} (${r.reason})`).padEnd(7)}  ${r.class.padEnd(7)}  ${r.action}  ${r.scope}  until ${r.validUntil}  session ${r.session}`);
        return 0;
      }
      if (args[0] === "ceremonies" && d.ceremonies != null) {
        const rows = d.ceremonies.execute();
        if (rows.length === 0) { d.print("no MADE ceremonies started by a session"); return 0; }
        for (const c of rows) {
          d.print(`${c.summary}  ${c.state === "running" ? "running" : `ended (${c.endReason})`}  started ${c.startedAt}  session ${c.session}`);
          for (const g of c.grants) d.print(`  ${g.grantId}  ${g.reason === null ? g.state : `${g.state} (${g.reason})`}  ${g.action}`);
        }
        return 0;
      }
      if (args[0] === "revoke-orphans") {
        const r = await d.revoke.execute();
        d.print(r.orphans === 0 ? "no orphan MADE grants" : `revoked ${r.revoked}/${r.orphans} orphan MADE grants`);
        return r.revoked === r.orphans ? 0 : 1;
      }
      return this.#usage();
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }

  #usage(): number { this.#d.print(USAGE); return 2; }
}
