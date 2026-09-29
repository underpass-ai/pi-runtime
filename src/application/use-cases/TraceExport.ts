import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../domain/events/ProjectionCursor.ts";
import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import { Timestamp } from "../../domain/events/Timestamp.ts";
import type { AssemblerState } from "../../domain/telemetry/AssemblerState.ts";
import { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { Span } from "../../domain/telemetry/Span.ts";
import { SpanAssembler } from "../../domain/telemetry/SpanAssembler.ts";
import type { TelemetryResource } from "../../domain/telemetry/TelemetryResource.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import type { TelemetrySink } from "../ports/TelemetrySink.ts";

const BATCH = 512;
const READ = 500;
const STATE_KEY = "assembler";

// Exportador de trazas con cursor propio (`otlp_traces`). Una pasada: parte de una
// instantánea (cursor + estado del ensamblador), ensambla desde el cursor hasta reunir
// 512 spans o llegar al final del log, añade los incompletos por tiempo (con el reloj
// de pared sólo si no queda atraso) y envía. Sólo
// tras un 2xx (o un 4xx, que descarta el lote) confirma estado y cursor con el
// compare-and-set de E1. Si otro escritor (un rebuild) movió el cursor, la pasada no
// cuenta (devuelve `stale`) y la siguiente parte de la instantánea nueva: los ids son los mismos.
export class TraceExport {
  static readonly NAME = ProjectionName.of("otlp_traces");
  static readonly VERSION = 1;
  readonly #events: EventStore; readonly #store: ProjectionStore; readonly #sink: TelemetrySink; readonly #resource: TelemetryResource;
  constructor(events: EventStore, store: ProjectionStore, sink: TelemetrySink, resource: TelemetryResource) {
    this.#events = events; this.#store = store; this.#sink = sink; this.#resource = resource;
  }

  async execute(now: Timestamp): Promise<ExportResult> {
    const snap = this.#store.snapshot(TraceExport.NAME);
    let cursor = snap.cursor; let saved = snap.state.get(STATE_KEY) as AssemblerState | undefined;
    if (cursor === null || cursor.version !== TraceExport.VERSION) {
      this.#store.reset(TraceExport.NAME, TraceExport.VERSION);
      cursor = ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.START); saved = undefined;
    }
    const assembler = new SpanAssembler(saved ?? SpanAssembler.empty());
    const spans: Span[] = [];
    let position = cursor.position; let drained = false; let seenMs = 0;
    reading: while (spans.length < BATCH) {
      const batch = this.#events.readAll(position, READ);
      if (batch.length === 0) { drained = true; break; }
      for (const e of batch) {
        if (spans.length >= BATCH) break reading;
        spans.push(...assembler.feed(e.record));
        position = e.position; seenMs = Math.max(seenMs, e.record.recordedAt.epochMs());
      }
    }
    // Con atraso sin leer, el reloj de pared expiraría tools cuyo cierre sigue en el log:
    // mientras se pone al día, el "ahora" es el recordedAt más alto ya leído.
    spans.push(...assembler.expire(drained ? now : Timestamp.fromEpochMs(seenMs)));
    if (spans.length === 0 && position.equals(cursor.position)) return ExportResult.ok();

    let outcome = ExportResult.ok();
    for (let i = 0; i < spans.length; i += BATCH) {
      const result = await this.#sink.sendSpans(this.#resource, spans.slice(i, i + BATCH));
      if (result.kind === "retryable") return result;
      if (result.kind === "rejected") outcome = result;
    }
    const committed = this.#store.commit(TraceExport.NAME, cursor, ProjectionCursor.of(TraceExport.VERSION, position), new Map([[STATE_KEY, assembler.state()]]));
    return committed ? outcome : ExportResult.stale();
  }

  // Eventos del log que el exportador aún no ha procesado (sin cursor válido, desde el principio).
  lag(): number {
    const c = this.#store.cursor(TraceExport.NAME);
    const done = c === null || c.version !== TraceExport.VERSION ? 0 : c.position.value;
    return Math.max(0, this.#events.lastPosition().value - done);
  }
}
