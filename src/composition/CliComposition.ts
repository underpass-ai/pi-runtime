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
import { SqliteMadePolicyCensus } from "../adapters/outbound/sqlite/SqliteMadePolicyCensus.ts";
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
import { EventLogComposition } from "./EventLogComposition.ts";
import { RepoFile } from "./RepoFile.ts";
import { StatePaths } from "./StatePaths.ts";
import { TelemetryEnvironment } from "./TelemetryEnvironment.ts";

export class CliComposition {
  static build(env: Record<string, string | undefined>, print: (s: string) => void): UnderpassCli {
    const repoRoot = RepoFile.path("");
    const paths = new StatePaths(env);
    const pins = new JsonPinSetSource(RepoFile.path("pins.json")).load();
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

    const eventLog = new EventLogComposition(paths, project, print, TelemetryEnvironment.configuration(env));
    const setup = new SetupInstallation(install, ensure, new BootstrapMadeAuthorization(new MadeCliAuthorizationBootstrapper(madeBin)), piPackages, store, repoRoot);
    const doctor = new DiagnoseInstallation(verify, new PiCliRuntimeInspector(), piPackages, kmp, new FsFingerprintRepository(paths.fingerprintsFile()),
      connect, new VerifyServerProfiles(ToolProfiles.standard()), new DiscoverMadeCapabilities(), pins.pi.version,
      eventLog.diagnosis(), eventLog.madeAuthorization(new SqliteMadePolicyCensus(), store));

    return new UnderpassCli(setup, doctor, print, eventLog.cli(), eventLog.metrics(), eventLog.learning(), eventLog.made(() => connect(ServerName.MADE)));
  }
}
