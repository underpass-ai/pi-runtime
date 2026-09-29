import { join } from "node:path";
import { FsOwnerLock } from "../adapters/outbound/fs/FsOwnerLock.ts";
import { FsOrphanSpoolSource } from "../adapters/outbound/fs/FsOrphanSpoolSource.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { UnixSocketHostServer } from "../adapters/inbound/ipc/UnixSocketHostServer.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { SystemClock } from "../adapters/outbound/clock/SystemClock.ts";
import { SqliteDatabase } from "../adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { LazyMadeServerCommandFactory } from "../adapters/outbound/process/LazyMadeServerCommandFactory.ts";
import type { ServerCommandFactory } from "../application/ports/ServerCommandFactory.ts";
import type { ServerLifecycleListener } from "../application/ports/ServerLifecycleListener.ts";
import { SessionSummaryProjection } from "../application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../application/projections/ToolStatsProjection.ts";
import { HostFactFactory } from "../application/services/HostFactFactory.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
import { ServerPool } from "../application/services/ServerPool.ts";
import { AdoptOrphanSpools } from "../application/use-cases/AdoptOrphanSpools.ts";
import { ReadSessionSummary } from "../application/use-cases/ReadSessionSummary.ts";
import { ReadSessionStatus } from "../application/use-cases/ReadSessionStatus.ts";
import { RecordFact } from "../application/use-cases/RecordFact.ts";
import { ServeHostRequest } from "../application/use-cases/ServeHostRequest.ts";
import { BinaryName } from "../domain/distribution/BinaryName.ts";
import type { Fact } from "../domain/events/Fact.ts";
import { PackageInfo } from "./PackageInfo.ts";
import { StatePaths } from "./StatePaths.ts";

export class HostComposition {
  static async run(projectCwd: string, env: Record<string, string | undefined>, commands?: Map<string, ServerCommandFactory>): Promise<void> {
    const project = new GitProjectLocator().locate(projectCwd);
    const paths = new StatePaths(env);
    const lock = new FsOwnerLock(paths.projectDir(project)).acquire();
    if (!lock.owned) return;

    // Log de eventos del proyecto. Un fallo al registrar nunca tumba el host:
    // se deja constancia en stderr (host.log) y se sigue sirviendo.
    const clock = new SystemClock();
    const db = SqliteDatabase.open(paths.eventLogOf(project));
    const events = new SqliteEventStore(db);
    const projectionStore = new SqliteProjectionStore(db);
    const runner = new ProjectionRunner(events, projectionStore, [new SessionSummaryProjection(), new ToolStatsProjection()]);
    const record = new RecordFact(events, clock, () => runner.runOnce());
    const hostFacts = new HostFactFactory(clock, String(process.pid));
    const safeRecord = (f: Fact) => { try { record.execute(f); } catch (e) { console.error(`event log: ${(e as Error).message}`); } };
    const listener: ServerLifecycleListener = { started: (s, id) => safeRecord(hostFacts.serverStarted(s, id)), exited: (s) => safeRecord(hostFacts.serverExited(s)) };

    const pool = new ServerPool(project, new StdioMcpConnector(60_000), commands ?? HostComposition.commands(env, paths), listener);
    const serve = new ServeHostRequest(project, pool, record, new ReadSessionStatus(events, new ReadSessionSummary(projectionStore, () => runner.runOnce())));
    const server = await UnixSocketHostServer.start(paths.socketOf(project), (req) => serve.execute(req));
    safeRecord(hostFacts.hostStarted(PackageInfo.version(), process.pid));
    // Spools de procesos de Pi muertos: se adoptan al arrancar y en cada tick.
    const orphans = new AdoptOrphanSpools(new FsOrphanSpoolSource(paths.spoolDirOf(project)), record);
    const adopt = () => {
      try {
        const r = orphans.execute();
        if (r.files > 0) console.error(`fact spool: adopted ${r.files} orphan spool(s): ${r.recorded} recorded, ${r.invalid} invalid, ${r.retained} retained`);
      } catch (e) { console.error(`fact spool: ${(e as Error).message}`); }
    };
    adopt();

    const idleMs = Number(env.UNDERPASS_HOST_IDLE_MS ?? 60_000);
    let idleSince = Date.now();
    const projectionTimer = setInterval(() => { adopt(); try { runner.runOnce(); } catch (e) { console.error(`projections: ${(e as Error).message}`); } }, 5_000);
    let stopping = false;
    // host.stopped se registra tras cerrar el pool (y con él los server.exited)
    // y siempre antes de cerrar la base de datos.
    const shutdown = async (reason: "idle" | "signal") => {
      clearInterval(timer); clearInterval(projectionTimer);
      try { await server.close(); await pool.close(); safeRecord(hostFacts.hostStopped(reason)); runner.runOnce(); }
      finally { db.close(); lock.release(); }
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

  // Cableado de producción de los servidores del host (público para probarlo).
  static commands(env: Record<string, string | undefined>, paths: StatePaths): Map<string, ServerCommandFactory> {
    const pins = new JsonPinSetSource(new URL("../../pins.json", import.meta.url).pathname).load();
    const bin = (n: BinaryName) => join(paths.binDir(), pins.pinFor(n).installedFileName());
    const made = new LazyMadeServerCommandFactory(bin(BinaryName.MADE), paths.madeStore(), new FsMadeConfigurationRepository(paths.madeConfigRoot()), env);
    return new Map<string, ServerCommandFactory>([["kmp", new KmpServerCommandFactory(bin(BinaryName.KMP), env)], ["made", made]]);
  }
}
