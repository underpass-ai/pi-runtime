import { existsSync, readFileSync } from "node:fs";
import { EventsCli } from "../adapters/inbound/cli/EventsCli.ts";
import { LearningCli } from "../adapters/inbound/cli/LearningCli.ts";
import { MadeCli } from "../adapters/inbound/cli/MadeCli.ts";
import { MetricsCli } from "../adapters/inbound/cli/MetricsCli.ts";
import { SystemClock } from "../adapters/outbound/clock/SystemClock.ts";
import { FsSpoolGapMarkers } from "../adapters/outbound/fs/FsSpoolGapMarkers.ts";
import { FsSpoolInspector } from "../adapters/outbound/fs/FsSpoolInspector.ts";
import { InMemoryEventStore } from "../adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { SqliteDatabase } from "../adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { SqliteTelemetryEpochStore } from "../adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import type { EventStore } from "../application/ports/EventStore.ts";
import type { McpConnection } from "../application/ports/McpConnection.ts";
import type { Projection } from "../application/ports/Projection.ts";
import type { ProjectionStore } from "../application/ports/ProjectionStore.ts";
import type { TelemetryEpochStore } from "../application/ports/TelemetryEpochStore.ts";
import { QualityKpisProjection } from "../application/projections/QualityKpisProjection.ts";
import { SessionSummaryProjection } from "../application/projections/SessionSummaryProjection.ts";
import { TelemetryMetricsProjection } from "../application/projections/TelemetryMetricsProjection.ts";
import { LearningEvalProjection } from "../application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../application/projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../application/projections/ToolStatsProjection.ts";
import { LearningFactFactory } from "../application/services/LearningFactFactory.ts";
import { MadeFactFactory } from "../application/services/MadeFactFactory.ts";
import { MadeOwner } from "../application/services/MadeOwner.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../application/services/TelemetryEpochs.ts";
import { AcknowledgeSpoolGaps } from "../application/use-cases/AcknowledgeSpoolGaps.ts";
import { ChangeLearningMode } from "../application/use-cases/ChangeLearningMode.ts";
import { DiagnoseEventLog } from "../application/use-cases/DiagnoseEventLog.ts";
import { DiagnoseLearning } from "../application/use-cases/DiagnoseLearning.ts";
import { DiagnoseTelemetry } from "../application/use-cases/DiagnoseTelemetry.ts";
import { ExportEventLog } from "../application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../application/use-cases/ImportEventLog.ts";
import { LearningReport } from "../application/use-cases/LearningReport.ts";
import { ListMadeGrants } from "../application/use-cases/ListMadeGrants.ts";
import { ListSessions } from "../application/use-cases/ListSessions.ts";
import { ProjectionLag } from "../application/use-cases/ProjectionLag.ts";
import { QualityKpisReport } from "../application/use-cases/QualityKpisReport.ts";
import { ReadTelemetryMetrics } from "../application/use-cases/ReadTelemetryMetrics.ts";
import { RebuildProjection } from "../application/use-cases/RebuildProjection.ts";
import { RecordFact } from "../application/use-cases/RecordFact.ts";
import { RevokeMadeGrants } from "../application/use-cases/RevokeMadeGrants.ts";
import { SessionTrace } from "../application/use-cases/SessionTrace.ts";
import { ShowSession } from "../application/use-cases/ShowSession.ts";
import { ToolStatsReport } from "../application/use-cases/ToolStatsReport.ts";
import { VerifyEventLog } from "../application/use-cases/VerifyEventLog.ts";
import type { Check } from "../domain/diagnosis/Check.ts";
import { Actor } from "../domain/events/Actor.ts";
import type { Project } from "../domain/project/Project.ts";
import { OtlpConfiguration } from "../domain/telemetry/OtlpConfiguration.ts";
import { LazyEventStore } from "./LazyEventStore.ts";
import { LazyProjectionStore } from "./LazyProjectionStore.ts";
import type { StatePaths } from "./StatePaths.ts";

// read: sólo lectura (doctor y consultas); write: lectura-escritura si el log existe (rebuild); create: lo crea (import).
type Mode = "read" | "write" | "create";
type Stores = { events: EventStore; projections: ProjectionStore; epochs: TelemetryEpochStore; persisted: boolean };

// Cableado del log de eventos para el CLI. Sin log, lectura y rebuild trabajan sobre almacenes vacíos en memoria:
// nada se crea salvo con `events import`, y aun entonces sólo tras validar el bundle.
export class EventLogComposition {
  readonly #log: string; readonly #spool: string; readonly #project: Project; readonly #print: (s: string) => void; readonly #telemetry: OtlpConfiguration;
  constructor(paths: StatePaths, project: Project, print: (s: string) => void, telemetry: OtlpConfiguration = OtlpConfiguration.DISABLED) {
    this.#log = paths.eventLogOf(project); this.#spool = paths.spoolDirOf(project); this.#project = project; this.#print = print; this.#telemetry = telemetry;
  }

  diagnosis(): { execute(): Check[] } {
    return {
      execute: () => {
        const s = this.#open("read");
        // Sin log no hay cursores que comparar: la lista vacía evita un falso "version mismatch".
        return [
          ...new DiagnoseEventLog(s.events, s.projections, s.persisted ? this.#projections() : [], new FsSpoolInspector(this.#spool)).execute(),
          ...new DiagnoseTelemetry(s.events, s.projections, this.#telemetry, new SystemClock()).execute(),
          ...new DiagnoseLearning(s.events, s.projections).execute(),
        ];
      },
    };
  }

  cli(): { run(args: string[]): number } {
    return {
      run: (args: string[]) => {
        const mode: Mode = args[0] === "import" ? "create" : args[0] === "rebuild" ? "write" : "read";
        let stores: Stores | null = null;
        const resolve = () => (stores ??= this.#open(mode));
        const events = new LazyEventStore(() => resolve().events); const projections = new LazyProjectionStore(() => resolve().projections);
        return new EventsCli({
          sessions: new ListSessions(projections), show: new ShowSession(events), tools: new ToolStatsReport(projections),
          kpis: new QualityKpisReport(projections), trace: new SessionTrace(events), metrics: new ReadTelemetryMetrics(events, projections),
          verify: new VerifyEventLog(events),
          exportLog: new ExportEventLog(events, this.#project.id), importLog: new ImportEventLog(events, this.#project.id),
          rebuild: new RebuildProjection(new ProjectionRunner(events, projections, this.#projections()), projections, this.#epochs(resolve)),
          lag: new ProjectionLag(events, projections, this.#projections()), ackGaps: new AcknowledgeSpoolGaps(new FsSpoolGapMarkers(this.#spool)), readFile: (p) => readFileSync(p, "utf8"), print: this.#print,
        }).run(args);
      },
    };
  }

  metrics(): { run(args: string[]): number } {
    return {
      run: (args: string[]) => {
        let stores: Stores | null = null;
        const resolve = () => (stores ??= this.#open("read"));
        const events = new LazyEventStore(() => resolve().events); const projections = new LazyProjectionStore(() => resolve().projections);
        return new MetricsCli({ read: new ReadTelemetryMetrics(events, projections), lag: new ProjectionLag(events, projections, this.#projections()), print: this.#print }).run(args);
      },
    };
  }

  // `underpass learning`: report sólo lee; mode registra el hecho (y crea el log si no existe).
  learning(): { run(args: string[]): number } {
    return {
      run: (args: string[]) => {
        let stores: Stores | null = null;
        const resolve = () => (stores ??= this.#open(args[0] === "mode" ? "create" : "read"));
        const events = new LazyEventStore(() => resolve().events); const projections = new LazyProjectionStore(() => resolve().projections);
        const clock = new SystemClock();
        const mode = new ChangeLearningMode(events, new RecordFact(events, clock), new LearningFactFactory(clock, "cli", Actor.of("human", "underpass-cli")));
        return new LearningCli({ report: new LearningReport(projections), mode, lag: new ProjectionLag(events, projections, this.#projections()), print: this.#print }).run(args);
      },
    };
  }

  // `underpass made`: grants sólo lee; revoke-orphans escribe en un log que ya exista y sólo
  // arranca MADE (connect) si hay huérfanos. La conexión se cierra al terminar.
  made(connect: () => Promise<McpConnection>): { run(args: string[]): Promise<number> } {
    return {
      run: async (args: string[]) => {
        let stores: Stores | null = null;
        const events = new LazyEventStore(() => (stores ??= this.#open(args[0] === "revoke-orphans" ? "write" : "read")).events);
        const opened: { connection: Promise<McpConnection> | null } = { connection: null };
        const clock = new SystemClock();
        const revoke = new RevokeMadeGrants(events, new MadeOwner(() => (opened.connection ??= connect())), new RecordFact(events, clock),
          new MadeFactFactory(clock, Actor.of("human", "underpass-cli")), clock);
        try { return await new MadeCli({ grants: new ListMadeGrants(events, clock), revoke, print: this.#print }).run(args); }
        finally { if (opened.connection !== null) await (await opened.connection.catch(() => null))?.close(); }
      },
    };
  }

  // Las mismas proyecciones que mantiene el host (HostComposition).
  #projections(): Projection[] {
    return [new SessionSummaryProjection(), new ToolStatsProjection(), new TelemetryMetricsProjection(), new QualityKpisProjection(), new ToolBanditProjection(), new LearningEvalProjection()];
  }

  #epochs(resolve: () => Stores): TelemetryEpochs {
    return new TelemetryEpochs({ read: () => resolve().epochs.read(), write: (e) => resolve().epochs.write(e) }, new SystemClock());
  }

  #open(mode: Mode): Stores {
    if (mode !== "create" && !existsSync(this.#log)) return { events: new InMemoryEventStore(), projections: new InMemoryProjectionStore(), epochs: new InMemoryTelemetryEpochStore(), persisted: false };
    const db = mode === "read" ? SqliteDatabase.openReadOnly(this.#log) : SqliteDatabase.open(this.#log);
    return { events: new SqliteEventStore(db), projections: new SqliteProjectionStore(db), epochs: new SqliteTelemetryEpochStore(db), persisted: true };
  }
}
