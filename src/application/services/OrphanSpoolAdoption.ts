import type { Clock } from "../ports/Clock.ts";
import type { AdoptOrphanSpools } from "../use-cases/AdoptOrphanSpools.ts";
import { SpoolRetryBackoff } from "./SpoolRetryBackoff.ts";

// Servicio de adopción del host (un tick al arrancar y cada 5 s). Guarda el
// retroceso de cada fichero que falla, para no reintentarlo en cada tick, y lo
// olvida al adoptarlo o si desaparece. Sólo registra cambios de estado: el
// primer fallo de un fichero, su recuperación y las adopciones; nunca un
// reintento fallido más. Los fallos (retenido, error al reclamar) son `warn`; la
// recuperación y las adopciones, `info`.
export class OrphanSpoolAdoption {
  readonly #adopt: AdoptOrphanSpools; readonly #clock: Clock; readonly #log: (level: "info" | "warn", line: string) => void;
  readonly #backoff = new Map<string, SpoolRetryBackoff>();
  #claimError: string | null = null;
  constructor(adopt: AdoptOrphanSpools, clock: Clock, log: (level: "info" | "warn", line: string) => void) { this.#adopt = adopt; this.#clock = clock; this.#log = log; }

  tick(): void {
    const now = this.#clock.now().epochMs();
    let claims: string[];
    try { claims = this.#adopt.claims(); }
    catch (e) {
      const message = (e as Error)?.message ?? String(e);
      if (message !== this.#claimError) this.#log("warn", `fact spool: ${message}`);
      this.#claimError = message;
      return;
    }
    if (this.#claimError !== null) { this.#claimError = null; this.#log("info", "fact spool: orphan adoption recovered"); }
    for (const known of [...this.#backoff.keys()]) if (!claims.includes(known)) this.#backoff.delete(known);

    let files = 0; let recorded = 0; let invalid = 0;
    for (const claim of claims) {
      const previous = this.#backoff.get(claim);
      if (previous && !previous.isDue(now)) continue;
      const r = this.#adopt.adopt(claim);
      recorded += r.recorded; invalid += r.invalid;
      if (r.failure === null) {
        files++;
        if (previous) { this.#backoff.delete(claim); this.#log("info", `fact spool: ${claim} adopted after ${previous.failures()} failed attempt(s)`); }
        continue;
      }
      this.#backoff.set(claim, previous ? previous.failedAgain(now) : SpoolRetryBackoff.first(now));
      if (!previous) this.#log("warn", `fact spool: ${claim} retained (${r.failure}); retrying with backoff from 5s up to 5min`);
    }
    if (files > 0) this.#log("info", `fact spool: adopted ${files} orphan spool(s): ${recorded} recorded, ${invalid} invalid`);
  }
}
