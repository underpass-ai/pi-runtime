import type { Timestamp } from "../../domain/events/Timestamp.ts";
import { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { ExporterStatusDto } from "../dto/ExporterStatusDto.ts";
import type { Clock } from "../ports/Clock.ts";
import type { MetricsExport } from "../use-cases/MetricsExport.ts";
import type { TraceExport } from "../use-cases/TraceExport.ts";
import { ExportBackoff } from "./ExportBackoff.ts";
import type { ExporterHealth } from "./ExporterHealth.ts";

const MAX_ROUNDS = 20;

// Bucle de exportación del host. Nunca lanza ni bloquea: cada tick es una promesa que el
// host no espera. Las pasadas (de trazas y de métricas) van en una sola cola: nunca hay
// dos a la vez; un tick de una señal con otra pasada suya pendiente devuelve esa misma.
// Tras un fallo reintentable de las trazas espera (1 s doblando hasta 5 min); con atraso
// encadena pasadas (hasta MAX_ROUNDS) en el mismo tick. Una pasada `stale` (un rebuild
// ganó el compare-and-set) no es éxito ni fallo: corta el encadenado, no toca la espera
// ni la salud, y el tick siguiente reintenta. Las métricas no tienen espera ni cola.
export class TelemetryExporter {
  readonly #traces: TraceExport; readonly #metrics: MetricsExport; readonly #health: ExporterHealth; readonly #clock: Clock;
  #backoff: ExportBackoff | null = null;
  #tail: Promise<void> = Promise.resolve();
  #traceRun: Promise<void> | null = null;
  #metricsRun: Promise<void> | null = null;

  constructor(traces: TraceExport, metrics: MetricsExport, health: ExporterHealth, clock: Clock) {
    this.#traces = traces; this.#metrics = metrics; this.#health = health; this.#clock = clock;
  }

  tickTraces(): Promise<void> {
    if (this.#traceRun !== null) return this.#traceRun;
    const run = this.#enqueue(() => this.#runTraces()).finally(() => { this.#traceRun = null; });
    this.#traceRun = run;
    return run;
  }

  tickMetrics(): Promise<void> {
    if (this.#metricsRun !== null) return this.#metricsRun;
    const run = this.#enqueue(async () => {
      const result = await TelemetryExporter.#safely(() => this.#metrics.execute());
      this.#health.record("metrics", result, this.#clock.now());
    }).finally(() => { this.#metricsRun = null; });
    this.#metricsRun = run;
    return run;
  }

  // Para el apagado del host: espera lo que esté en cola o en vuelo y hace una última pasada de cada señal.
  async flush(): Promise<void> {
    for (let tail = this.#tail; ; tail = this.#tail) { await tail; if (tail === this.#tail) break; }
    await this.tickTraces();
    await this.tickMetrics();
  }

  status(): ExporterStatusDto { return this.#health.status(this.#lag()); }

  // La cola nunca queda rechazada: un fallo de una pasada (p. ej. del log del host) no bloquea las siguientes.
  #enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.#tail.then(work).catch(() => undefined);
    this.#tail = run;
    return run;
  }

  async #runTraces(): Promise<void> {
    const now = this.#clock.now();
    if (this.#backoff !== null && !this.#backoff.isDue(now.epochMs())) return;
    let decisive: ExportResult | null = null;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const result = await TelemetryExporter.#safely(() => this.#traces.execute(round === 0 ? now : this.#clock.now()));
      if (result.kind === "stale") break;
      decisive = result;
      if (result.kind === "retryable" || this.#lag() === 0) break;
    }
    if (decisive === null) return;
    // La espera se fija antes de registrar: un log que lance no puede dejarla sin poner.
    this.#backoff = decisive.kind !== "retryable" ? null : this.#backoff === null ? ExportBackoff.first(now.epochMs()) : this.#backoff.failedAgain(now.epochMs());
    this.#health.record("traces", decisive, now);
  }

  #lag(): number { try { return this.#traces.lag(); } catch { return 0; } }

  // Un error inesperado cuenta como fallo reintentable; sólo se guarda su tipo (el mensaje podría llevar rutas).
  static async #safely(run: () => Promise<ExportResult>): Promise<ExportResult> {
    try { return await run(); } catch (e) { return ExportResult.retryable(`internal ${e instanceof Error ? e.name : "error"}`); }
  }
}
