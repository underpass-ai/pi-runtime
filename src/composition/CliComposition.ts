import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EventsCli } from "../adapters/inbound/cli/EventsCli.ts";
import { FsSpoolInspector } from "../adapters/outbound/fs/FsSpoolInspector.ts";
import { InMemoryEventStore } from "../adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../adapters/outbound/sqlite/SqliteProjectionStore.ts";
import type { EventStore } from "../application/ports/EventStore.ts";
import type { ProjectionStore } from "../application/ports/ProjectionStore.ts";
import { SessionSummaryProjection } from "../application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../application/projections/ToolStatsProjection.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
import { DiagnoseEventLog } from "../application/use-cases/DiagnoseEventLog.ts";
import { ExportEventLog } from "../application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../application/use-cases/ImportEventLog.ts";
import { ListSessions } from "../application/use-cases/ListSessions.ts";
import { RebuildProjection } from "../application/use-cases/RebuildProjection.ts";
import { ShowSession } from "../application/use-cases/ShowSession.ts";
import { ToolStatsReport } from "../application/use-cases/ToolStatsReport.ts";
import { VerifyEventLog } from "../application/use-cases/VerifyEventLog.ts";
import { NodeEntropySource } from "../adapters/outbound/crypto/NodeEntropySource.ts";
import { FsBinaryInstallation } from "../adapters/outbound/fs/FsBinaryInstallation.ts";
import { FsFingerprintRepository } from "../adapters/outbound/fs/FsFingerprintRepository.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { NodeFileDigester } from "../adapters/outbound/fs/NodeFileDigester.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { GithubReleaseDownloader } from "../adapters/outbound/github/GithubReleaseDownloader.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { KmpCliLifecycle } from "../adapters/outbound/process/KmpCliLifecycle.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeCliAuthorizationBootstrapper } from "../adapters/outbound/process/MadeCliAuthorizationBootstrapper.ts";
import { LazyMadeServerCommandFactory } from "../adapters/outbound/process/LazyMadeServerCommandFactory.ts";
import { PiCliPackageManager } from "../adapters/outbound/process/PiCliPackageManager.ts";
import { PiCliRuntimeInspector } from "../adapters/outbound/process/PiCliRuntimeInspector.ts";
import { UnderpassCli } from "../adapters/inbound/cli/UnderpassCli.ts";
import { BootstrapMadeAuthorization } from "../application/use-cases/BootstrapMadeAuthorization.ts";
import { DiagnoseInstallation } from "../application/use-cases/DiagnoseInstallation.ts";
import { DiscoverMadeCapabilities } from "../application/use-cases/DiscoverMadeCapabilities.ts";
import { EnsureMadeConfiguration } from "../application/use-cases/EnsureMadeConfiguration.ts";
import { InstallPinnedBinaries } from "../application/use-cases/InstallPinnedBinaries.ts";
import { VerifyPinnedBinaries } from "../application/use-cases/VerifyPinnedBinaries.ts";
import { SetupInstallation } from "../application/use-cases/SetupInstallation.ts";
import { VerifyServerProfiles } from "../application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../domain/contracts/ToolProfiles.ts";
import { BinaryName } from "../domain/distribution/BinaryName.ts";
import { Target } from "../domain/distribution/Target.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { StatePaths } from "./StatePaths.ts";

export class CliComposition {
  static build(env: Record<string, string | undefined>, print: (s: string) => void): UnderpassCli {
    const repoRoot = new URL("../../", import.meta.url).pathname;
    const paths = new StatePaths(env);
    const pins = new JsonPinSetSource(join(repoRoot, "pins.json")).load();
    const installation = new FsBinaryInstallation(paths.binDir());
    const target = Target.detect(process.platform, process.arch);
    const install = new InstallPinnedBinaries(pins, target, new GithubReleaseDownloader(), new NodeFileDigester(), installation);
    const verify = new VerifyPinnedBinaries(pins, target, new NodeFileDigester(), installation);
    const kmpBin = installation.pathOf(pins.pinFor(BinaryName.KMP));
    const madeBin = installation.pathOf(pins.pinFor(BinaryName.MADE));
    const store = paths.madeStore();
    const configs = new FsMadeConfigurationRepository(paths.madeConfigRoot());
    const ensure = new EnsureMadeConfiguration(configs, new NodeEntropySource());
    const kmp = new KmpCliLifecycle(kmpBin, env);
    const piPackages = new PiCliPackageManager();
    const project = new GitProjectLocator().locate(process.cwd());
    const connector = new StdioMcpConnector(60_000);
    // doctor sólo LEE la configuración privada de MADE (nunca la crea ni la rota).
    const made = new LazyMadeServerCommandFactory(madeBin, store, configs, env);
    const connect = async (s: ServerName) => {
      if (s.equals(ServerName.KMP)) return connector.open(s, new KmpServerCommandFactory(kmpBin, env).commandFor(project));
      return connector.open(s, made.commandFor(project));
    };

    const setup = new SetupInstallation(install, ensure, new BootstrapMadeAuthorization(new MadeCliAuthorizationBootstrapper(madeBin)), piPackages, store, repoRoot);
    const doctor = new DiagnoseInstallation(verify, new PiCliRuntimeInspector(), piPackages, kmp, new FsFingerprintRepository(paths.fingerprintsFile()),
      connect, new VerifyServerProfiles(ToolProfiles.standard()), new DiscoverMadeCapabilities(), pins.pi.version,
      { execute: () => diagnose().execute() });

    // Log de eventos en perezoso. Sólo `events import` puede crearlo (SqliteDatabase.open crea el fichero):
    // doctor y los verbos de lectura, sin log, trabajan sobre almacenes vacíos en memoria y no escriben nada.
    const eventLog = paths.eventLogOf(project);
    type Stores = { events: EventStore; projections: ProjectionStore; persisted: boolean };
    let opened: Stores | null = null;
    const storesFor = (create: boolean): Stores => {
      if (opened !== null) return opened;
      if (!create && !existsSync(eventLog)) return { events: new InMemoryEventStore(), projections: new InMemoryProjectionStore(), persisted: false };
      const db = SqliteDatabase.open(eventLog);
      return (opened = { events: new SqliteEventStore(db), projections: new SqliteProjectionStore(db), persisted: true });
    };
    const projections = () => [new SessionSummaryProjection(), new ToolStatsProjection()];
    // Sin log no hay cursores que comparar: la lista vacía evita un falso "version mismatch".
    const diagnose = () => {
      const s = storesFor(false);
      return new DiagnoseEventLog(s.events, s.projections, s.persisted ? projections() : [], new FsSpoolInspector(paths.spoolDirOf(project)));
    };
    const eventsCli = (create: boolean, readFile: (p: string) => string) => {
      const s = storesFor(create);
      return new EventsCli({
        sessions: new ListSessions(s.projections), show: new ShowSession(s.events), tools: new ToolStatsReport(s.projections), verify: new VerifyEventLog(s.events),
        exportLog: new ExportEventLog(s.events, project.id), importLog: new ImportEventLog(s.events),
        rebuild: new RebuildProjection(new ProjectionRunner(s.events, s.projections, projections())), readFile, print,
      });
    };
    const events = {
      run: (args: string[]) => {
        try {
          // `import` lee el bundle antes de abrir (y crear) el log: un fichero ilegible no deja un log vacío detrás.
          if (args[0] === "import" && args[1]) { const bundle = readFileSync(args[1], "utf8"); return eventsCli(true, () => bundle).run(args); }
          return eventsCli(false, (p) => readFileSync(p, "utf8")).run(args);
        }
        catch (e) { print(`error: ${(e as Error).message}`); return 1; }
      },
    };
    return new UnderpassCli(setup, doctor, print, events);
  }
}
