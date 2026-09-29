import type { ListMadeGrants } from "../../../application/use-cases/ListMadeGrants.ts";
import type { RevokeMadeGrants } from "../../../application/use-cases/RevokeMadeGrants.ts";

type Deps = { grants: ListMadeGrants; revoke: RevokeMadeGrants; print: (s: string) => void };
const USAGE = "usage: underpass made grants | revoke-orphans";

// `underpass made grants` y `underpass made revoke-orphans` (S3a §5).
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
