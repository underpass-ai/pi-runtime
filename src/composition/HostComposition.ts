import { join } from "node:path";
import { FsOwnerLock } from "../adapters/outbound/fs/FsOwnerLock.ts";
import { FsFingerprintRepository } from "../adapters/outbound/fs/FsFingerprintRepository.ts";
import { FsTelemetryKeyRepository } from "../adapters/outbound/fs/FsTelemetryKeyRepository.ts";
import { FsOrphanSpoolSource } from "../adapters/outbound/fs/FsOrphanSpoolSource.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { NodeEntropySource } from "../adapters/outbound/crypto/NodeEntropySource.ts";
import { MadeFactFactory } from "../application/services/MadeFactFactory.ts";
import { MadeOwner } from "../application/services/MadeOwner.ts";
import { PendingConfirmations } from "../application/services/PendingConfirmations.ts";
import { CallMadeTool } from "../application/use-cases/CallMadeTool.ts";
import { DeclineMadeConfirmation } from "../application/use-cases/DeclineMadeConfirmation.ts";
import { RevokeMadeGrants } from "../application/use-cases/RevokeMadeGrants.ts";
import { MadeActionPolicy } from "../domain/made/MadeActionPolicy.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { UnixSocketHostServer } from "../adapters/inbound/ipc/UnixSocketHostServer.ts";
import { JsonLineLogger } from "../adapters/outbound/log/JsonLineLogger.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { SystemClock } from "../adapters/outbound/clock/SystemClock.ts";
import { OtlpHttpTelemetrySink } from "../adapters/outbound/otlp/OtlpHttpTelemetrySink.ts";
import { OtlpJsonMapper } from "../adapters/outbound/otlp/OtlpJsonMapper.ts";
import { SqliteDatabase } from "../adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { SqliteTelemetryEpochStore } from "../adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { LazyMadeServerCommandFactory } from "../adapters/outbound/process/LazyMadeServerCommandFactory.ts";
import type { Clock } from "../application/ports/Clock.ts";
import type { EventStore } from "../application/ports/EventStore.ts";
import type { HostLog } from "../application/ports/HostLog.ts";
import type { Projection } from "../application/ports/Projection.ts";
import type { ProjectionStore } from "../application/ports/ProjectionStore.ts";
import type { ServerCommandFactory } from "../application/ports/ServerCommandFactory.ts";
import type { ServerLifecycleListener } from "../application/ports/ServerLifecycleListener.ts";
import { QualityKpisProjection } from "../application/projections/QualityKpisProjection.ts";
import { SessionSummaryProjection } from "../application/projections/SessionSummaryProjection.ts";
import { TelemetryMetricsProjection } from "../application/projections/TelemetryMetricsProjection.ts";
import { LearningEvalProjection } from "../application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../application/projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../application/projections/ToolStatsProjection.ts";
import { ExporterHealth } from "../application/services/ExporterHealth.ts";
import { HostFactFactory } from "../application/services/HostFactFactory.ts";
import { KnownCatalogs } from "../application/services/KnownCatalogs.ts";
import { LearningFactFactory } from "../application/services/LearningFactFactory.ts";
import { OrphanSpoolAdoption } from "../application/services/OrphanSpoolAdoption.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
import { ServerPool } from "../application/services/ServerPool.ts";
import { TelemetryEpochs } from "../application/services/TelemetryEpochs.ts";
import { TelemetryExporter } from "../application/services/TelemetryExporter.ts";
import { EnsureTelemetryKey } from "../application/use-cases/EnsureTelemetryKey.ts";
import { AdoptOrphanSpools } from "../application/use-cases/AdoptOrphanSpools.ts";
import { MetricsExport } from "../application/use-cases/MetricsExport.ts";
import { QualityKpisReport } from "../application/use-cases/QualityKpisReport.ts";
import { ReadLearningStatus } from "../application/use-cases/ReadLearningStatus.ts";
import { ReadMadeStatus } from "../application/use-cases/ReadMadeStatus.ts";
import { ReadSessionSummary } from "../application/use-cases/ReadSessionSummary.ts";
import { ReadSessionStatus } from "../application/use-cases/ReadSessionStatus.ts";
import { ReadTelemetryMetrics } from "../application/use-cases/ReadTelemetryMetrics.ts";
import { RecordFact } from "../application/use-cases/RecordFact.ts";
import { SelectTools } from "../application/use-cases/SelectTools.ts";
import { ServeHostRequest } from "../application/use-cases/ServeHostRequest.ts";
import { TraceExport } from "../application/use-cases/TraceExport.ts";
import { BinaryName } from "../domain/distribution/BinaryName.ts";
import { Actor } from "../domain/events/Actor.ts";
import type { Fact } from "../domain/events/Fact.ts";
import type { CatalogFingerprint } from "../domain/mcp/CatalogFingerprint.ts";
import type { Project } from "../domain/project/Project.ts";
import { PhaseToolSelection } from "../domain/session/PhaseToolSelection.ts";
import type { OtlpConfiguration } from "../domain/telemetry/OtlpConfiguration.ts";
import { TelemetryInstanceId } from "../domain/telemetry/TelemetryInstanceId.ts";
import type { TelemetryKey } from "../domain/telemetry/TelemetryKey.ts";
import { TraceId } from "../domain/telemetry/TraceId.ts";
import { TelemetryKeyError } from "../application/ports/TelemetryKeyError.ts";
import { Deadline } from "./Deadline.ts";
import { PackageInfo } from "./PackageInfo.ts";
import { RepoFile } from "./RepoFile.ts";
import { StatePaths } from "./StatePaths.ts";
import { TelemetryEnvironment } from "./TelemetryEnvironment.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Tope de la exportación final en el apagado: una petición de trazas y otra de métricas,
// cada una con OTEL_EXPORTER_OTLP_TIMEOUT, y nunca más de 30 s aunque el timeout sea mayor.
const flushDeadline = (timeoutMs: number) => Math.min(2 * timeoutMs + 1_000, 30_000);
// Tope de la espera a las revocaciones de MADE en curso durante el apagado.
const REVOKE_DEADLINE_MS = 5_000;

export class HostComposition {
  // Adopta los spools huérfanos y, si adoptó alguno, barre los grants de MADE huérfanos.
  static adoptionTick(adopt: () => number, sweep: () => void): void { if (adopt() > 0) sweep(); }

  static async run(projectCwd: string, env: Record<string, string | undefined>, commands?: Map<string, ServerCommandFactory>): Promise<void> {
    const project = new GitProjectLocator().locate(projectCwd);
    const paths = new StatePaths(env);
    const lock = new FsOwnerLock(paths.projectDir(project)).acquire();
    if (!lock.owned) return;

    // host.log es JSON por líneas con rotación (JsonLineLogger); stdout/stderr del proceso
    // van a host.stderr.log. Un fallo al registrar nunca tumba el host.
    const clock = new SystemClock();
    const log = new JsonLineLogger(paths.hostLogOf(project), clock);
    const db = SqliteDatabase.open(paths.eventLogOf(project));
    const events = new SqliteEventStore(db);
    const projectionStore = new SqliteProjectionStore(db);
    const runner = new ProjectionRunner(events, projectionStore, HostComposition.projections());
    const record = new RecordFact(events, clock, () => runner.runOnce(), (e) => log.error("projections failed", { error: message(e) }));
    const hostFacts = new HostFactFactory(clock, String(process.pid));
    const safeRecord = (f: Fact) => {
      try { record.execute(f); }
      catch (e) { log.error("event log append failed", { error: message(e), type: f.type.value, trace_id: f.stream.isSession() ? TraceId.forStream(f.stream).value : null }); }
    };
    const listener: ServerLifecycleListener = { started: (s, id) => safeRecord(hostFacts.serverStarted(s, id)), exited: (s, code) => safeRecord(hostFacts.serverExited(s, code)) };

    const pool = new ServerPool(project, new StdioMcpConnector(60_000), commands ?? HostComposition.commands(env, paths), listener);
    const otlp = TelemetryEnvironment.configuration(env);
    const telemetry = HostComposition.#exporter(otlp, env, paths, project, events, projectionStore, db, clock, log);
    const status = new ReadSessionStatus(events, new ReadSessionSummary(projectionStore, () => runner.runOnce()), new QualityKpisReport(projectionStore),
      () => telemetry?.status() ?? { state: "disabled", lag: 0, since: null }, new ReadLearningStatus(projectionStore), new ReadMadeStatus(events, clock));
    // L1: el host decide con el estado del bandit y registra tools.selected (spec §7).
    const catalogs = new KnownCatalogs();
    const hostActor = `host:${process.pid}`;
    const select = new SelectTools(projectionStore, record, new LearningFactFactory(clock, hostActor, Actor.of("host", hostActor)), PhaseToolSelection.standard(), catalogs,
      HostComposition.#learningProject(paths, project, log), () => runner.runOnce());
    // S3a: el host concede, pide confirmación y audita la autorización de MADE.
    const madeConnection = () => pool.connection(ServerName.MADE);
    const madeFacts = new MadeFactFactory(clock, Actor.of("host", hostActor));
    const confirmations = new PendingConfirmations(new NodeEntropySource(), clock);
    const owner = new MadeOwner(madeConnection);
    // F3: la misma revocación (una sola cadena) sirve al cierre de la sesión y al terminal de una instancia.
    const revoke = new RevokeMadeGrants(events, owner, record, madeFacts, clock, log);
    const made = {
      call: new CallMadeTool({ connection: madeConnection, owner, policy: MadeActionPolicy.standard(), confirmations, record, facts: madeFacts, clock, log, events, revoke }),
      decline: new DeclineMadeConfirmation(confirmations, record, madeFacts),
      revoke,
    };
    const serve = new ServeHostRequest(project, pool, record, status, select, catalogs, made);
    const server = await UnixSocketHostServer.start(paths.socketOf(project), (req) => serve.execute(req));
    safeRecord(hostFacts.hostStarted(PackageInfo.version(), process.pid, HostComposition.#catalogs(paths)));
    // El inicio del acumulado de métricas se fija con la primera proyección y sobrevive a los reinicios.
    try { runner.runOnce(); new TelemetryEpochs(new SqliteTelemetryEpochStore(db), clock).current(); }
    catch (e) { log.error("telemetry projections failed", { error: message(e) }); }
    // Spools de procesos de Pi muertos: se adoptan al arrancar y en cada tick,
    // con retroceso por fichero para los que fallan (ver OrphanSpoolAdoption).
    const orphans = new OrphanSpoolAdoption(new AdoptOrphanSpools(new FsOrphanSpoolSource(paths.spoolDirOf(project)), record), clock, (level, line) => (level === "warn" ? log.warn(line) : log.info(line)));
    const adopt = () => { try { return orphans.tick(); } catch (e) { log.error("fact spool adoption failed", { error: message(e) }); return 0; } };
    adopt();
    // S3a §4: los grants que un host anterior dejó vivos (sesión cerrada o abandonada) se revocan al
    // arrancar, después de adoptar los spools: un session.closed que esperaba en uno ya cuenta.
    void made.revoke.execute();
    void telemetry?.tickTraces();

    const idleMs = Number(env.UNDERPASS_HOST_IDLE_MS ?? 60_000);
    let idleSince = Date.now();
    const projectionTimer = setInterval(() => {
      // Un spool adoptado puede traer el session.closed de una sesión con grants vivos (su Pi murió
      // con el host caído): sólo entonces se vuelve a barrer, nunca en cada tick.
      HostComposition.adoptionTick(adopt, () => void made.revoke.execute());
      try { runner.runOnce(); } catch (e) { log.error("projections failed", { error: message(e) }); }
      void telemetry?.tickTraces();
    }, 5_000);
    // Métricas: snapshot acumulado cada 15 s, sin cola (un fallo lo cubre el siguiente).
    // Sin exportador no hay temporizador de métricas.
    const metricsTimer = telemetry === null ? null : setInterval(() => { void telemetry.tickMetrics(); }, 15_000);
    let stopping = false;
    // host.stopped se registra tras cerrar el pool (y con él los server.exited); la última
    // exportación va después, con tope, y siempre antes de cerrar la base de datos.
    const shutdown = async (reason: "idle" | "signal") => {
      clearInterval(timer); clearInterval(projectionTimer); if (metricsTimer !== null) clearInterval(metricsTimer);
      try {
        await server.close();
        // Las revocaciones en curso (cierres de sesión, barrido de arranque) terminan antes de cerrar
        // el pool y la base de datos, con tope: MADE nunca retiene el apagado.
        if (!(await Deadline.within(made.revoke.settled(), REVOKE_DEADLINE_MS))) log.warn("made revocations timed out; orphans are revoked on the next start");
        await pool.close(); safeRecord(hostFacts.hostStopped(reason));
        try { runner.runOnce(); } catch (e) { log.error("projections failed", { error: message(e) }); }
        if (telemetry !== null && otlp.settings !== null && !(await Deadline.within(telemetry.flush(), flushDeadline(otlp.settings.timeoutMs)))) {
          log.warn("otlp final flush timed out; remaining telemetry is exported on the next start");
        }
      } finally { db.close(); lock.release(); }
    };
    const finish = (reason: "idle" | "signal") => {
      if (stopping) return;
      stopping = true;
      void shutdown(reason).then(() => process.exit(0)).catch(() => process.exit(1));
    };
    const timer = setInterval(() => {
      if (server.clients() > 0) idleSince = Date.now();
      else if (Date.now() - idleSince >= idleMs) finish("idle");
    }, Math.max(100, Math.min(1000, idleMs / 2)));
    process.once("SIGTERM", () => finish("signal"));
  }

  // Las proyecciones del host (EventLogComposition declara la misma lista para el CLI).
  static projections(): Projection[] {
    return [new SessionSummaryProjection(), new ToolStatsProjection(), new TelemetryMetricsProjection(), new QualityKpisProjection(), new ToolBanditProjection(), new LearningEvalProjection()];
  }

  // Motivo publicable de un fallo de la clave de telemetría: TelemetryKeyError nunca lleva ruta ni
  // clave; cualquier otro error (texto crudo del sistema de ficheros, con rutas) no se repite.
  static keyProblem(e: unknown): string { return e instanceof TelemetryKeyError ? e.message : "unexpected error"; }

  // Contexto de L1: el proyecto como id HMAC de O1, con la clave de la instalación (se crea
  // aquí si falta). Sin clave, cada selección responde fallback sin hecho; se avisa una vez.
  static #learningProject(paths: StatePaths, project: Project, log: HostLog): TelemetryInstanceId | null {
    try { return TelemetryInstanceId.derive(new EnsureTelemetryKey(new FsTelemetryKeyRepository(paths.telemetryKeyFile()), new NodeEntropySource()).execute(), project.id); }
    catch (e) { log.warn("learning disabled: telemetry key unavailable", { reason: HostComposition.keyProblem(e) }); return null; }
  }

  // Exportador OTLP: sólo con OTEL_EXPORTER_OTLP_ENDPOINT válida. Una configuración
  // inválida lo desactiva y se avisa una vez (sin repetir endpoint ni cabeceras). La clave
  // de telemetría se crea aquí la primera vez; sin ella tampoco se exporta (nunca se registra).
  static #exporter(configuration: OtlpConfiguration, env: Record<string, string | undefined>, paths: StatePaths, project: Project, events: EventStore, store: ProjectionStore, db: SqliteDatabase, clock: Clock, log: HostLog): TelemetryExporter | null {
    if (configuration.state === "invalid") log.warn("otlp exporter disabled: invalid configuration", { reason: configuration.problem });
    if (configuration.settings === null) return null;
    let key: TelemetryKey;
    try { key = new EnsureTelemetryKey(new FsTelemetryKeyRepository(paths.telemetryKeyFile()), new NodeEntropySource()).execute(); }
    catch (e) { log.warn("otlp exporter disabled: telemetry key unavailable", { reason: HostComposition.keyProblem(e) }); return null; }
    const resource = TelemetryEnvironment.resource(env, project, key);
    const sink = new OtlpHttpTelemetrySink(configuration.settings, new OtlpJsonMapper(PackageInfo.version()));
    const metrics = new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new SqliteTelemetryEpochStore(db), clock), sink, resource, clock);
    return new TelemetryExporter(new TraceExport(events, store, sink, resource), metrics, new ExporterHealth(log), clock);
  }

  // Huellas de catálogo que el host ya conoce (las que registró `underpass
  // setup`/doctor): sólo id de servidor y sha256. Sin fichero legible, vacío.
  static #catalogs(paths: StatePaths): Map<string, CatalogFingerprint> {
    try { return new FsFingerprintRepository(paths.fingerprintsFile()).load(); } catch { return new Map(); }
  }

  // Cableado de producción de los servidores del host (público para probarlo).
  static commands(env: Record<string, string | undefined>, paths: StatePaths): Map<string, ServerCommandFactory> {
    const pins = new JsonPinSetSource(RepoFile.path("pins.json")).load();
    const bin = (n: BinaryName) => join(paths.binDir(), pins.pinFor(n).installedFileName());
    const made = new LazyMadeServerCommandFactory(bin(BinaryName.MADE), paths.madeStore(), new FsMadeConfigurationRepository(paths.madeConfigRoot()), env);
    return new Map<string, ServerCommandFactory>([["kmp", new KmpServerCommandFactory(bin(BinaryName.KMP), env)], ["made", made]]);
  }
}
