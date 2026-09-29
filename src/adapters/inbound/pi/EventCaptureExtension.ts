import type { FactDto } from "../../../application/dto/FactDto.ts";
import type { FactSink } from "../../../application/ports/FactSink.ts";
import { HOST_READY, PHASE_CHANGED } from "./HostExtension.ts";
import type { PiEventFactMapper } from "./PiEventFactMapper.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" ? (v as Json) : {});

export class EventCaptureExtension {
  readonly #sinkFor: (cwd: string) => FactSink; readonly #mapper: PiEventFactMapper; readonly #now: () => number;
  #sink: FactSink | null = null; #sid: string | null = null; #turnStartedAt: number | null = null; #phase: string | null = null;
  readonly #toolStartedAt = new Map<string, number>();

  constructor(sinkFor: (cwd: string) => FactSink, mapper: PiEventFactMapper, now: () => number = () => Date.now()) { this.#sinkFor = sinkFor; this.#mapper = mapper; this.#now = now; }

  register(pi: PiExtensionApi): void {
    pi.on("session_start", (e, ctx) => {
      this.#sid = ctx.sessionManager?.getSessionId() ?? null;
      if (this.#sid === null) return;
      this.#sink = this.#sinkFor(ctx.cwd);
      this.#emit(this.#mapper.sessionOpened(this.#sid, String(obj(e).reason ?? "startup"), this.#now()));
    });
    pi.on("session_shutdown", (e) => {
      if (this.#sid !== null) this.#emit(this.#mapper.sessionClosed(this.#sid, String(obj(e).reason ?? "quit"), this.#now()));
      this.#sid = null; this.#sink = null; this.#toolStartedAt.clear(); this.#turnStartedAt = null; this.#phase = null;
    });
    pi.on("turn_start", (e) => { const ts = obj(e).timestamp; this.#turnStartedAt = typeof ts === "number" ? ts : this.#now(); });
    pi.on("turn_end", (e) => {
      if (this.#sid === null) return;
      this.#emit(this.#mapper.turnCompleted(this.#sid, e, this.#turnStartedAt, this.#now()));
      this.#turnStartedAt = null;
    });
    pi.on("tool_execution_start", (e) => {
      if (this.#sid === null) return;
      const at = this.#now(); this.#toolStartedAt.set(String(obj(e).toolCallId), at);
      this.#emit(this.#mapper.toolStarted(this.#sid, e, at));
    });
    pi.on("tool_execution_end", (e) => {
      if (this.#sid === null) return;
      const id = String(obj(e).toolCallId); const started = this.#toolStartedAt.get(id) ?? null; this.#toolStartedAt.delete(id);
      this.#emit(this.#mapper.toolCompleted(this.#sid, e, started, this.#now()));
    });
    pi.on("model_select", (e) => { if (this.#sid !== null) this.#emit(this.#mapper.modelSelected(this.#sid, e, this.#now())); });
    pi.on("session_compact", (e, ctx) => {
      if (this.#sid === null) return;
      const tokens = ctx.getContextUsage?.()?.tokens;
      this.#emit(this.#mapper.compacted(this.#sid, e, typeof tokens === "number" ? tokens : null, this.#now()));
    });
    pi.events.on(HOST_READY, () => { void this.#sink?.flush(); });
    pi.events.on(PHASE_CHANGED, (d) => {
      if (this.#sid === null) return;
      const data = obj(d); const phase = String(data.phase);
      this.#emit(this.#mapper.phaseChanged(this.#sid, this.#phase, phase, Array.isArray(data.activeTools) ? data.activeTools.map(String) : [], this.#now()));
      this.#phase = phase;
    });
  }

  #emit(fact: FactDto | null): void { if (fact !== null) this.#sink?.record(fact); }
}
