import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { ExporterStatusDto } from "../dto/ExporterStatusDto.ts";
import type { HostLog } from "../ports/HostLog.ts";

type Signal = "traces" | "metrics";

// Estado del exportador por señal. Deja como mucho una línea por cambio de estado: el
// primer fallo (o un motivo nuevo), la recuperación y cada motivo de descarte distinto.
// Un descarte (4xx) no es un fallo: el colector responde. Una pasada `stale` (perdió el
// compare-and-set frente a un rebuild) no dice nada del colector: no cambia el estado.
export class ExporterHealth {
  readonly #log: HostLog;
  readonly #failingSince = new Map<Signal, Timestamp>();
  readonly #last = new Map<Signal, string>();
  constructor(log: HostLog) { this.#log = log; }

  record(signal: Signal, result: ExportResult, now: Timestamp): void {
    if (result.kind === "stale") return;
    if (result.kind === "ok") {
      const since = this.#failingSince.get(signal);
      if (since !== undefined) this.#log.info("otlp exporter recovered", { signal, failing_since: since.value });
      this.#failingSince.delete(signal); this.#last.delete(signal);
      return;
    }
    if (result.kind === "retryable") { if (!this.#failingSince.has(signal)) this.#failingSince.set(signal, now); }
    else this.#failingSince.delete(signal);
    const state = `${result.kind}:${result.reason}`;
    if (this.#last.get(signal) === state) return;
    this.#last.set(signal, state);
    if (result.kind === "rejected") this.#log.warn("otlp batch rejected and dropped", { signal, reason: result.reason });
    else this.#log.warn("otlp export failing; retrying with backoff", { signal, reason: result.reason });
  }

  status(lag: number): ExporterStatusDto {
    const since = [...this.#failingSince.values()].sort((a, b) => a.epochMs() - b.epochMs())[0];
    return since === undefined ? { state: "ok", lag, since: null } : { state: "failing", lag, since: since.value };
  }
}
