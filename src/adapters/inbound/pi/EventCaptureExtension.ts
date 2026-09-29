import type { FactDto } from "../../../application/dto/FactDto.ts";
import type { FactSink } from "../../../application/ports/FactSink.ts";
import { HOST_READY, PHASE_CHANGED } from "./HostExtension.ts";
import type { PiEventFactMapper } from "./PiEventFactMapper.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" ? (v as Json) : {});
const level = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const callId = (e: unknown): string | null => { const id = obj(e).toolCallId; return typeof id === "string" && id.length > 0 ? id : null; };

// Captura de hechos de sesión sobre los eventos públicos de Pi. Nada de lo
// que haga aquí puede romper Pi: crear el sink, registrar o vaciar se
// protegen, y un fallo sólo pierde captura.
export class EventCaptureExtension {
  readonly #open: (cwd: string) => { sink: FactSink; project: string }; readonly #mapper: PiEventFactMapper; readonly #now: () => number; readonly #shutdownWaitMs: number;
  #sink: FactSink | null = null; #sid: string | null = null; #turnStartedAt: number | null = null; #phase: string | null = null; #effort: string | null = null;
  readonly #toolStartedAt = new Map<string, number>();

  // open(cwd) da el sink de la sesión y el id (hash) del proyecto.
  constructor(open: (cwd: string) => { sink: FactSink; project: string }, mapper: PiEventFactMapper, now: () => number = () => Date.now(), shutdownWaitMs = 2_000) {
    this.#open = open; this.#mapper = mapper; this.#now = now; this.#shutdownWaitMs = shutdownWaitMs;
  }

  register(pi: PiExtensionApi): void {
    pi.on("session_start", (e, ctx) => {
      this.#sid = ctx.sessionManager?.getSessionId() ?? null;
      if (this.#sid === null) return;
      let project: string;
      try { const opened = this.#open(ctx.cwd); this.#sink = opened.sink; project = opened.project; } catch { this.#sink = null; return; }
      this.#emit(this.#mapper.sessionOpened(this.#sid, String(obj(e).reason ?? "startup"), this.#now(), project));
    });
    // Se registra antes que el HostExtension (ver ExtensionComposition) y Pi
    // espera cada handler: session.closed se entrega, o queda en el spool,
    // antes de que el host cierre el gateway. La espera está acotada para
    // que un host colgado no bloquee la salida de Pi.
    pi.on("session_shutdown", async (e) => {
      const sink = this.#sink;
      if (this.#sid !== null) this.#emit(this.#mapper.sessionClosed(this.#sid, String(obj(e).reason ?? "quit"), this.#now()));
      this.#sid = null; this.#sink = null; this.#toolStartedAt.clear(); this.#turnStartedAt = null; this.#phase = null;
      if (sink !== null) await this.#bounded(sink);
    });
    pi.on("turn_start", (e) => { const ts = obj(e).timestamp; this.#turnStartedAt = typeof ts === "number" ? ts : this.#now(); });
    pi.on("turn_end", (e) => {
      if (this.#sid === null) return;
      this.#emit(this.#mapper.turnCompleted(this.#sid, e, this.#turnStartedAt, this.#now()));
      this.#turnStartedAt = null;
    });
    // Sin toolCallId no hay forma de emparejar ni un about único: no se emite.
    pi.on("tool_execution_start", (e) => {
      const id = callId(e);
      if (this.#sid === null || id === null) return;
      const at = this.#now(); this.#toolStartedAt.set(id, at);
      this.#emit(this.#mapper.toolStarted(this.#sid, e, at));
    });
    pi.on("tool_execution_end", (e) => {
      const id = callId(e);
      if (this.#sid === null || id === null) return;
      const started = this.#toolStartedAt.get(id) ?? null; this.#toolStartedAt.delete(id);
      this.#emit(this.#mapper.toolCompleted(this.#sid, e, started, this.#now()));
    });
    // El esfuerzo sale de ctx.thinkingLevel; si Pi no lo da, del último
    // thinking_level_select visto.
    pi.on("thinking_level_select", (e) => { this.#effort = level(obj(e).level); });
    pi.on("model_select", (e, ctx) => {
      if (this.#sid !== null) this.#emit(this.#mapper.modelSelected(this.#sid, e, this.#now(), level(ctx?.thinkingLevel) ?? this.#effort));
    });
    pi.on("session_compact", (e, ctx) => {
      if (this.#sid === null) return;
      const tokens = ctx.getContextUsage?.()?.tokens;
      this.#emit(this.#mapper.compacted(this.#sid, e, typeof tokens === "number" ? tokens : null, this.#now()));
    });
    pi.events.on(HOST_READY, () => { try { this.#sink?.flush().catch(() => undefined); } catch { /* sin captura */ } });
    pi.events.on(PHASE_CHANGED, (d) => {
      if (this.#sid === null) return;
      const data = obj(d); const phase = String(data.phase);
      if (phase === this.#phase) return;
      this.#emit(this.#mapper.phaseChanged(this.#sid, this.#phase, phase, Array.isArray(data.activeTools) ? data.activeTools.map(String) : [], this.#now()));
      this.#phase = phase;
    });
  }

  #emit(fact: FactDto | null): void {
    if (fact === null) return;
    try { this.#sink?.record(fact); } catch { /* sin captura */ }
  }

  async #bounded(sink: FactSink): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((r) => { timer = setTimeout(r, this.#shutdownWaitMs); });
    try { await Promise.race([Promise.resolve().then(() => sink.flush()).catch(() => undefined), timeout]); }
    finally { clearTimeout(timer); }
  }
}
