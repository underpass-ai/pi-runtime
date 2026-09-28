import { join } from "node:path";
import { NodeEntropySource } from "../adapters/outbound/crypto/NodeEntropySource.ts";
import { FsBinaryInstallation } from "../adapters/outbound/fs/FsBinaryInstallation.ts";
import { FsFingerprintRepository } from "../adapters/outbound/fs/FsFingerprintRepository.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import type { MadeConfiguration } from "../domain/made/MadeConfiguration.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { NodeFileDigester } from "../adapters/outbound/fs/NodeFileDigester.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { GithubReleaseDownloader } from "../adapters/outbound/github/GithubReleaseDownloader.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { KmpCliLifecycle } from "../adapters/outbound/process/KmpCliLifecycle.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeCliAuthorizationBootstrapper } from "../adapters/outbound/process/MadeCliAuthorizationBootstrapper.ts";
import { MadeServerCommandFactory } from "../adapters/outbound/process/MadeServerCommandFactory.ts";
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
import { StorePath } from "../domain/made/StorePath.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { StatePaths } from "./StatePaths.ts";

// El "doctor" nunca debe crear ni rotar la configuración privada de MADE: sólo
// `SetupInstallation` (vía `EnsureMadeConfiguration`) tiene permiso para generarla.
// Esta función es la única vía por la que la conexión usada por doctor obtiene
// la configuración, y se exporta para poder probarla sin levantar procesos reales.
export function loadMadeConfigurationOrThrow(configs: FsMadeConfigurationRepository, store: StorePath): MadeConfiguration {
  const configuration = configs.load(store);
  if (!configuration) throw new Error("MADE private configuration missing; run `underpass setup`");
  return configuration;
}

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
    const store = StorePath.of(env.MADE_MCP_STORE_PATH ?? join(env.XDG_STATE_HOME ?? join(env.HOME ?? "", ".local/state"), "underpass-made", "ceremonies.sqlite3"));
    const configs = new FsMadeConfigurationRepository(env);
    const ensure = new EnsureMadeConfiguration(configs, new NodeEntropySource());
    const kmp = new KmpCliLifecycle(kmpBin, paths.binDir(), env);
    const piPackages = new PiCliPackageManager();
    const project = new GitProjectLocator().locate(process.cwd());
    const connector = new StdioMcpConnector(60_000);
    const connect = (s: ServerName) => {
      if (s.equals(ServerName.KMP)) return connector.open(s, new KmpServerCommandFactory(kmpBin, env).commandFor(project));
      return connector.open(s, new MadeServerCommandFactory(madeBin, store, loadMadeConfigurationOrThrow(configs, store), env).commandFor(project));
    };

    const setup = new SetupInstallation(install, ensure, new BootstrapMadeAuthorization(new MadeCliAuthorizationBootstrapper(madeBin)), kmp, piPackages, store, repoRoot);
    const doctor = new DiagnoseInstallation(verify, new PiCliRuntimeInspector(), piPackages, kmp, new FsFingerprintRepository(paths.fingerprintsFile()),
      connect, new VerifyServerProfiles(ToolProfiles.standard()), new DiscoverMadeCapabilities(), pins.pi.version);
    return new UnderpassCli(setup, doctor, print);
  }
}
