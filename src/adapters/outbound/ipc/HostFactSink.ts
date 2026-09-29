import type { FactDto } from "../../../application/dto/FactDto.ts";
import { HostCallError } from "../../../application/ports/HostCallError.ts";
import type { FactSink } from "../../../application/ports/FactSink.ts";
import type { FactSpool } from "../../../application/ports/FactSpool.ts";
import type { HostGateway } from "../../../application/ports/HostGateway.ts";

const rejected = (e: unknown) => HostCallError.is(e) && e.kind === "invalid";

export class HostFactSink implements FactSink {
  readonly #gateway: () => Promise<HostGateway>; readonly #spool: FactSpool; #flushing: Promise<void> | null = null;
  constructor(gateway: () => Promise<HostGateway>, spool: FactSpool) { this.#gateway = gateway; this.#spool = spool; }

  record(fact: FactDto): void {
    if (this.#flushing !== null || this.#spool.pending() > 0) { this.#spool.append(fact); return; }
    this.#gateway().then((g) => g.record(fact)).catch((e) => { if (!rejected(e)) this.#spool.append(fact); });
  }

  flush(): Promise<void> {
    if (this.#flushing === null) this.#flushing = this.#drain().catch(() => undefined).finally(() => { this.#flushing = null; });
    return this.#flushing;
  }

  async #drain(): Promise<void> {
    for (;;) {
      const pending = this.#spool.readAll();
      if (pending.length === 0) return;
      const g = await this.#gateway();
      let done = 0;
      try {
        for (const f of pending) {
          try { await g.record(f); } catch (e) { if (!rejected(e)) throw e; }
          done++;
        }
      } finally { this.#spool.removeFirst(done); }
    }
  }
}
