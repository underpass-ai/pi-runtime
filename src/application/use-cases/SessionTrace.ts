import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import type { Span } from "../../domain/telemetry/Span.ts";
import { SpanAssembler } from "../../domain/telemetry/SpanAssembler.ts";
import type { SpanRowDto } from "../dto/SpanRowDto.ts";
import type { EventStore } from "../ports/EventStore.ts";

// Árbol de spans de una sesión, ensamblado desde su stream con el mismo SpanAssembler que
// el exportador. Lo que sigue abierto se cierra en el último hecho como incompleto.
export class SessionTrace {
  readonly #events: EventStore;
  constructor(events: EventStore) { this.#events = events; }

  execute(id: SessionId): SpanRowDto[] {
    const records = this.#events.readStream(StreamId.session(id));
    if (records.length === 0) return [];
    const assembler = new SpanAssembler(SpanAssembler.empty());
    const spans = records.flatMap((r) => assembler.feed(r));
    spans.push(...assembler.flush(records[records.length - 1].occurredAt));
    const ids = new Set(spans.map((s) => s.spanId.value));
    const children = new Map<string, Span[]>();
    for (const s of spans) {
      const parent = s.parentId !== null && ids.has(s.parentId.value) ? s.parentId.value : "";
      children.set(parent, [...(children.get(parent) ?? []), s]);
    }
    const rows: SpanRowDto[] = [];
    const walk = (parent: string, depth: number) => {
      const siblings = [...(children.get(parent) ?? [])].sort((a, b) => a.start.epochMs() - b.start.epochMs() || a.end.epochMs() - b.end.epochMs());
      for (const s of siblings) { rows.push(SessionTrace.#row(s, depth)); walk(s.spanId.value, depth + 1); }
    };
    walk("", 0);
    return rows;
  }

  static #row(s: Span, depth: number): SpanRowDto {
    const text = (k: string) => { const v = s.attributes.get(k); return v === null ? null : String(v); };
    const count = (k: string) => { const v = s.attributes.get(k); return typeof v === "number" ? v : 0; };
    const cost = s.attributes.get("pi_runtime.cost");
    const detail = s.name === "tool" ? `${text("pi_runtime.server") ?? "?"}/${text("pi_runtime.tool") ?? "?"} ${text("pi_runtime.status") ?? "open"}`
      : s.name === "turn" ? `${text("pi_runtime.model") ?? "?"} ${text("pi_runtime.outcome") ?? "?"}`
      : s.name === "session" ? text("pi_runtime.open_reason") : null;
    return {
      depth, name: s.name, startedAt: s.start.value, durationMs: s.durationMs(), status: s.status.value, detail,
      tokens: s.name === "turn" ? { input: count("pi_runtime.tokens.input"), output: count("pi_runtime.tokens.output") } : null,
      cost: s.name === "turn" && typeof cost === "number" ? cost : null,
      incomplete: s.attributes.get("pi_runtime.incomplete") === true,
    };
  }
}
