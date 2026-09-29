import type { FactDto } from "../../../application/dto/FactDto.ts";
import { HostCallError } from "../../../application/ports/HostCallError.ts";
import type { FactSink } from "../../../application/ports/FactSink.ts";
import type { FactSpool } from "../../../application/ports/FactSpool.ts";
import type { HostGateway } from "../../../application/ports/HostGateway.ts";

const rejected = (e: unknown) => HostCallError.is(e) && e.kind === "invalid";

// Entrega ordenada de hechos al host. Nunca lanza hacia Pi: un spool que no
// se puede leer o escribir pierde el hecho (FsFactSpool deja el hueco
// marcado cuando puede), pero no rompe la sesión.
//  - Sin pendientes ni flush en curso, el hecho va directo; si el transporte
//    falla, al spool.
//  - Con pendientes, el hecho espera en el spool y se dispara un flush: si el
//    host ha vuelto (aunque no haya HOST_READY) se reenvía todo en orden; si
//    no, el drain se para sin tocar el spool.
//  - flush() espera también a los envíos directos en vuelo, para que el cierre
//    de sesión sepa cuándo está todo entregado (o a salvo en el spool).
export class HostFactSink implements FactSink {
  readonly #gateway: () => Promise<HostGateway>; readonly #spool: FactSpool;
  #flushing: Promise<void> | null = null; #inflight: Promise<void> = Promise.resolve();

  constructor(gateway: () => Promise<HostGateway>, spool: FactSpool) { this.#gateway = gateway; this.#spool = spool; }

  record(fact: FactDto): void {
    let backlog: boolean;
    try { backlog = this.#flushing !== null || this.#spool.pending() > 0; } catch { return; }
    if (backlog) {
      this.#spoolSafely(fact);
      if (this.#flushing === null) void this.flush();
      return;
    }
    const sending = this.#gateway().then((g) => g.record(fact)).catch((e) => { if (!rejected(e)) this.#spoolSafely(fact); });
    this.#inflight = this.#inflight.then(() => sending);
  }

  flush(): Promise<void> {
    if (this.#flushing === null) {
      this.#flushing = this.#inflight.then(() => this.#drain()).catch(() => undefined).finally(() => { this.#flushing = null; });
    }
    return this.#flushing;
  }

  #spoolSafely(fact: FactDto): void { try { this.#spool.append(fact); } catch { /* sin spool: el hecho se pierde, Pi sigue */ } }

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
