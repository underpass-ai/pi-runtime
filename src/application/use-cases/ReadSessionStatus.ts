import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { StreamVerifier } from "../../domain/events/StreamVerifier.ts";
import type { ExporterStatusDto } from "../dto/ExporterStatusDto.ts";
import type { SessionStatusDto } from "../dto/SessionStatusDto.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { QualityKpisReport } from "./QualityKpisReport.ts";
import type { ReadSessionSummary } from "./ReadSessionSummary.ts";

// Sólo verifica el stream de la sesión pedida, no el log entero: es barato y es lo que
// /underpass-status necesita. KPIs y exportador sólo se añaden si se cablean.
export class ReadSessionStatus {
  readonly #events: EventStore; readonly #summaries: ReadSessionSummary;
  readonly #kpis: QualityKpisReport | null; readonly #exporter: (() => ExporterStatusDto) | null;
  constructor(events: EventStore, summaries: ReadSessionSummary, kpis: QualityKpisReport | null = null, exporter: (() => ExporterStatusDto) | null = null) {
    this.#events = events; this.#summaries = summaries; this.#kpis = kpis; this.#exporter = exporter;
  }

  execute(id: SessionId): SessionStatusDto {
    const summary = this.#summaries.execute(id);
    const verification = StreamVerifier.verify(this.#events.readStream(StreamId.session(id)));
    const status: SessionStatusDto = { summary, logPosition: this.#events.lastPosition().value, sessionChainIntact: verification.kind !== "broken" };
    if (this.#kpis !== null) status.kpis = this.#kpis.execute(id);
    if (this.#exporter !== null) status.exporter = this.#exporter();
    return status;
  }
}
