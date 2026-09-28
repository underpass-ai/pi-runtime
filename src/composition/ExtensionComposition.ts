import { readFileSync } from "node:fs";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { DetachedHostLauncher } from "../adapters/outbound/process/DetachedHostLauncher.ts";
import { HostExtension } from "../adapters/inbound/pi/HostExtension.ts";
import type { PiExtensionApi } from "../adapters/inbound/pi/PiExtensionApi.ts";
import { PiToolFactory } from "../adapters/inbound/pi/PiToolFactory.ts";
import { ServerToolsExtension } from "../adapters/inbound/pi/ServerToolsExtension.ts";
import { ConnectToProjectHost } from "../application/use-cases/ConnectToProjectHost.ts";
import { SelectPhaseTools } from "../application/use-cases/SelectPhaseTools.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { PhaseToolSelection } from "../domain/session/PhaseToolSelection.ts";
import { SharedInstance } from "./SharedInstance.ts";
import { StatePaths } from "./StatePaths.ts";

// El registro vive en globalThis (ver SharedInstance.ts) y sobrevive a una
// recarga de extensiones dentro del mismo proceso de pi. Si `underpass
// update` cambia de versión mientras ese proceso sigue vivo, una recarga
// posterior no debe reutilizar el HostExtension de la versión anterior:
// se versiona la clave con el `version` de package.json en el momento de
// componer, así que versiones distintas nunca comparten instancia.
function packageVersion(): string {
  const url = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}

const HOST_EXTENSION_KEY = `underpass-pi.host-extension@${packageVersion()}`;

export class ExtensionComposition {
  static #select = new SelectPhaseTools(PhaseToolSelection.standard());

  // Pi carga host.ts, kmp.ts y made.ts como extensiones separadas, cada una
  // con jiti en su propio realm de módulos (moduleCache: false): un campo
  // estático de clase no basta para compartir el HostExtension entre ellas.
  // sharedInstance() usa globalThis, que sí es el mismo objeto de proceso
  // en los tres realms.
  static #shared(): HostExtension {
    return SharedInstance.get(HOST_EXTENSION_KEY, () => {
      const paths = new StatePaths(process.env);
      const connect = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p),
        new DetachedHostLauncher(new URL("../../bin/underpass-host.ts", import.meta.url).pathname, process.env));
      return new HostExtension((cwd) => connect.execute(cwd), this.#select);
    });
  }

  static host(pi: PiExtensionApi): void { this.#shared().register(pi); }

  static server(pi: PiExtensionApi, server: ServerName, toSchema: (json: Record<string, unknown>) => unknown): void {
    new ServerToolsExtension(server, this.#shared(), new PiToolFactory(toSchema)).register(pi);
  }
}
