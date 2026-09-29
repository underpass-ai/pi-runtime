import { EventId } from "../events/EventId.ts";
import type { EventRecord } from "../events/EventRecord.ts";
import { StreamId } from "../events/StreamId.ts";
import { Timestamp } from "../events/Timestamp.ts";
import type { AssemblerState } from "./AssemblerState.ts";
import { Span } from "./Span.ts";
import { SpanAttributes } from "./SpanAttributes.ts";
import { SpanEvent } from "./SpanEvent.ts";
import { SpanId } from "./SpanId.ts";
import type { SpanJson } from "./SpanJson.ts";
import { SpanStatus } from "./SpanStatus.ts";
import { TraceId } from "./TraceId.ts";

type Json = Record<string, unknown>;
type Extra = Record<string, string | number | boolean | null>;
type Session = AssemblerState["sessions"][string];
type OpenTool = Session["tools"][string];
type Host = NonNullable<AssemblerState["host"]>;
type OpenServer = Host["servers"][string];

const INCOMPLETE_AFTER_MS = 10 * 60_000;
const MAX_SESSION_EVENTS = 128;
const MAX_EXPIRED = 512;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const attrs = (values: Extra) => SpanAttributes.of(values).toRecord();
const at = (ms: number) => Timestamp.fromEpochMs(Math.max(0, Math.round(ms)));

// Convierte hechos ordenados en spans cerrados (spec §4). Determinista: sin reloj ni
// E/S; el único tiempo externo es el `now` de expire. El estado es explícito y JSON.
export class SpanAssembler {
  readonly #state: AssemblerState;
  constructor(state: AssemblerState) { this.#state = structuredClone(state); }

  static empty(): AssemblerState { return { sessions: {}, host: null }; }
  state(): AssemblerState { return structuredClone(this.#state); }

  feed(r: EventRecord): Span[] { return r.stream.isSession() ? this.#session(r) : this.#host(r); }

  // Tools sin cierre (o cerradas sin turno) con más de 10 min desde su recordedAt.
  expire(now: Timestamp): Span[] {
    const out: Span[] = [];
    for (const [stream, s] of Object.entries(this.#state.sessions)) {
      const trace = TraceId.forStream(StreamId.of(stream)); const parent = SpanId.of(s.spanId);
      for (const [callId, t] of Object.entries(s.tools)) {
        const deadline = t.recordedAtMs + INCOMPLETE_AFTER_MS;
        if (now.epochMs() < deadline) continue;
        out.push(this.#incomplete(trace, parent, t, deadline));
        delete s.tools[callId];
        this.#expire(s, callId);
      }
      const due = s.pending.filter((x) => now.epochMs() >= x.recordedAtMs + INCOMPLETE_AFTER_MS);
      s.pending = s.pending.filter((x) => !due.includes(x));
      out.push(...due.map((x) => SpanAssembler.#withParent(x.span, parent)));
    }
    return out;
  }

  // Cierra todo lo abierto como incompleto (para `events trace`, que muestra también lo que sigue en curso).
  flush(when: Timestamp): Span[] {
    const out: Span[] = [];
    for (const stream of Object.keys(this.#state.sessions)) {
      const s = this.#state.sessions[stream];
      delete this.#state.sessions[stream];
      out.push(...this.#closeSession(StreamId.of(stream), s, when.epochMs(), { "pi_runtime.incomplete": true }));
    }
    const h = this.#state.host;
    if (h !== null) { this.#state.host = null; out.push(...this.#closeHost(h, when.epochMs(), { "pi_runtime.incomplete": true })); }
    return out;
  }

  #session(r: EventRecord): Span[] {
    const key = r.stream.value; const s = this.#state.sessions[key]; const p = obj(r.payload.toValue()); const ms = r.occurredAt.epochMs();
    switch (r.type.value) {
      case "session.opened": {
        const out = s ? this.#closeSession(r.stream, s, ms, { "pi_runtime.reopened": true }) : [];
        this.#state.sessions[key] = {
          spanId: SpanId.forEvent(r.id).value, startMs: ms,
          attributes: attrs({ "pi_runtime.session_id": r.stream.sessionId().value, "pi_runtime.open_reason": str(p.reason), "pi_runtime.version": str(p.piRuntimeVersion), "pi_runtime.pi_version": str(p.piVersion) }),
          events: [], tools: {}, pending: [], expired: s ? s.expired : [],
        };
        return out;
      }
      case "session.closed":
        if (!s) return [];
        delete this.#state.sessions[key];
        return this.#closeSession(r.stream, s, ms, { "pi_runtime.close_reason": str(p.reason) });
      case "phase.changed": return this.#event(s, "phase.changed", ms, { "pi_runtime.phase.from": str(p.from), "pi_runtime.phase.to": str(p.to), "pi_runtime.active_tools": num(p.activeTools) });
      case "model.selected": return this.#event(s, "model.selected", ms, { "pi_runtime.model": str(p.model), "pi_runtime.provider": str(p.provider), "pi_runtime.effort": str(p.effort) });
      case "context.compacted": return this.#event(s, "context.compacted", ms, { "pi_runtime.tokens_before": num(p.tokensBefore), "pi_runtime.tokens_after": num(p.tokensAfter), "pi_runtime.reason": str(p.reason) });
      case "tool.started": {
        const callId = str(p.callId);
        if (!s || callId === null || s.expired.includes(callId)) return [];
        s.tools[callId] = { eventId: r.id.value, startMs: ms, recordedAtMs: r.recordedAt.epochMs(), attributes: attrs({ "pi_runtime.tool": str(p.tool), "pi_runtime.server": str(p.server), "pi_runtime.args_bytes": num(p.argsBytes) }) };
        return [];
      }
      case "tool.completed": {
        const callId = str(p.callId);
        if (!s || callId === null || s.expired.includes(callId)) return [];
        const open = s.tools[callId];
        delete s.tools[callId];
        const status = str(p.status);
        const span = Span.of({
          traceId: TraceId.forStream(r.stream), spanId: SpanId.forEvent(open ? EventId.of(open.eventId) : r.id), parentId: null, name: "tool",
          start: at(open?.startMs ?? ms - (num(p.durationMs) ?? 0)), end: r.occurredAt, status: status === "failed" ? SpanStatus.ERROR : SpanStatus.UNSET,
          attributes: SpanAttributes.of({ ...(open?.attributes ?? {}), "pi_runtime.tool": str(p.tool), "pi_runtime.server": str(p.server), "pi_runtime.status": status,
            "pi_runtime.error_kind": str(p.errorKind), "pi_runtime.error_code": str(p.errorCode), "pi_runtime.output_bytes": num(p.outputBytes) }),
          events: [],
        });
        s.pending.push({ span: span.toJson(), recordedAtMs: r.recordedAt.epochMs() });
        return [];
      }
      case "turn.completed": {
        if (!s) return [];
        const tokens = obj(p.tokens); const turnId = SpanId.forEvent(r.id);
        const turn = Span.of({
          traceId: TraceId.forStream(r.stream), spanId: turnId, parentId: SpanId.of(s.spanId), name: "turn",
          start: at(ms - (num(p.durationMs) ?? 0)), end: r.occurredAt, status: p.outcome === "error" ? SpanStatus.ERROR : SpanStatus.UNSET,
          attributes: SpanAttributes.of({ "pi_runtime.model": str(p.model), "pi_runtime.provider": str(p.provider), "pi_runtime.tokens.input": num(tokens.input),
            "pi_runtime.tokens.output": num(tokens.output), "pi_runtime.tokens.cache_read": num(tokens.cacheRead), "pi_runtime.tokens.cache_write": num(tokens.cacheWrite),
            "pi_runtime.cost": num(p.cost), "pi_runtime.outcome": str(p.outcome), "pi_runtime.stop_reason": str(p.stopReason) }),
          events: [],
        });
        return [turn, ...s.pending.splice(0).map((x) => SpanAssembler.#withParent(x.span, turnId))];
      }
      default: return [];
    }
  }

  #event(s: Session | undefined, name: string, ms: number, values: Extra): Span[] {
    if (s && s.events.length < MAX_SESSION_EVENTS) s.events.push({ name, atMs: ms, attributes: attrs(values) });
    return [];
  }

  #closeSession(stream: StreamId, s: Session, ms: number, extra: Extra): Span[] {
    const trace = TraceId.forStream(stream); const sessionId = SpanId.of(s.spanId);
    const out: Span[] = [Span.of({
      traceId: trace, spanId: sessionId, parentId: null, name: "session", start: at(s.startMs), end: at(ms), status: SpanStatus.UNSET,
      attributes: SpanAttributes.of({ ...s.attributes, ...extra }),
      events: s.events.map((e) => SpanEvent.of(e.name, at(e.atMs), SpanAttributes.of(e.attributes))),
    })];
    out.push(...s.pending.splice(0).map((x) => SpanAssembler.#withParent(x.span, sessionId)));
    for (const [callId, t] of Object.entries(s.tools)) { out.push(this.#incomplete(trace, sessionId, t, ms)); this.#expire(s, callId); }
    s.tools = {};
    return out;
  }

  #incomplete(trace: TraceId, parent: SpanId, t: OpenTool, endMs: number): Span {
    return Span.of({ traceId: trace, spanId: SpanId.forEvent(EventId.of(t.eventId)), parentId: parent, name: "tool", start: at(t.startMs), end: at(Math.max(t.startMs, endMs)),
      status: SpanStatus.UNSET, attributes: SpanAttributes.of({ ...t.attributes, "pi_runtime.incomplete": true }), events: [] });
  }

  #expire(s: Session, callId: string): void { s.expired = [...s.expired, callId].slice(-MAX_EXPIRED); }

  static #withParent(span: SpanJson, parent: SpanId): Span { return Span.fromJson({ ...span, parentId: parent.value }); }

  #host(r: EventRecord): Span[] {
    const p = obj(r.payload.toValue()); const ms = r.occurredAt.epochMs(); const h = this.#state.host;
    switch (r.type.value) {
      case "host.started": {
        const out = h ? this.#closeHost(h, ms, { "pi_runtime.incomplete": true }) : [];
        this.#state.host = { traceId: TraceId.forHostRun(r.id).value, spanId: SpanId.forEvent(r.id).value, startMs: ms, attributes: attrs({ "pi_runtime.version": str(p.version) }), servers: {} };
        return out;
      }
      case "host.stopped":
        if (!h) return [];
        this.#state.host = null;
        return this.#closeHost(h, ms, { "pi_runtime.stop_reason": str(p.reason) });
      case "server.started": {
        if (!h) return [];
        const server = str(p.server) ?? "unknown"; const previous = h.servers[server];
        h.servers[server] = { spanId: SpanId.forEvent(r.id).value, startMs: ms, attributes: attrs({ "pi_runtime.server": server, "pi_runtime.server_version": str(p.version) }) };
        return previous ? [this.#server(h, previous, ms, { "pi_runtime.incomplete": true })] : [];
      }
      case "server.exited": {
        const server = str(p.server) ?? "unknown"; const open = h?.servers[server];
        if (!h || !open) return [];
        delete h.servers[server];
        return [this.#server(h, open, ms, { "pi_runtime.exit_code": typeof p.code === "number" && Number.isInteger(p.code) ? p.code : "unknown" })];
      }
      default: return [];
    }
  }

  #closeHost(h: Host, ms: number, extra: Extra): Span[] {
    const servers = Object.values(h.servers).map((s) => this.#server(h, s, ms, { "pi_runtime.incomplete": true }));
    return [Span.of({ traceId: TraceId.of(h.traceId), spanId: SpanId.of(h.spanId), parentId: null, name: "host", start: at(h.startMs), end: at(ms), status: SpanStatus.UNSET,
      attributes: SpanAttributes.of({ ...h.attributes, ...extra }), events: [] }), ...servers];
  }

  #server(h: Host, s: OpenServer, ms: number, extra: Extra): Span {
    return Span.of({ traceId: TraceId.of(h.traceId), spanId: SpanId.of(s.spanId), parentId: SpanId.of(h.spanId), name: "mcp_server", start: at(s.startMs), end: at(ms),
      status: SpanStatus.UNSET, attributes: SpanAttributes.of({ ...s.attributes, ...extra }), events: [] });
  }
}
