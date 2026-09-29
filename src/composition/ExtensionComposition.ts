import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { DetachedHostLauncher } from "../adapters/outbound/process/DetachedHostLauncher.ts";
import { FsFactSpool } from "../adapters/outbound/fs/FsFactSpool.ts";
import { HostFactSink } from "../adapters/outbound/ipc/HostFactSink.ts";
import { EventCaptureExtension } from "../adapters/inbound/pi/EventCaptureExtension.ts";
import { HostExtension } from "../adapters/inbound/pi/HostExtension.ts";
import { PiEventFactMapper } from "../adapters/inbound/pi/PiEventFactMapper.ts";
import type { PiExtensionApi } from "../adapters/inbound/pi/PiExtensionApi.ts";
import { PiToolFactory } from "../adapters/inbound/pi/PiToolFactory.ts";
import { ServerToolsExtension } from "../adapters/inbound/pi/ServerToolsExtension.ts";
import { ConnectToProjectHost } from "../application/use-cases/ConnectToProjectHost.ts";
import { SelectPhaseTools } from "../application/use-cases/SelectPhaseTools.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { PhaseToolSelection } from "../domain/session/PhaseToolSelection.ts";
import { PackageInfo } from "./PackageInfo.ts";
import { SharedInstance } from "./SharedInstance.ts";
import { StatePaths } from "./StatePaths.ts";

// El registro vive en globalThis (ver SharedInstance.ts) y sobrevive a una
// recarga de extensiones dentro del mismo proceso de pi. Si `underpass
// update` cambia de versión mientras ese proceso sigue vivo, una recarga
// posterior no debe reutilizar el HostExtension de la versión anterior:
// se versiona la clave con el `version` de package.json en el momento de
// componer, así que versiones distintas nunca comparten instancia.
const HOST_EXTENSION_KEY = `pi-runtime.host-extension@${PackageInfo.version()}`;

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
        new DetachedHostLauncher(new URL("../../bin/underpass-host.ts", import.meta.url).pathname, process.env, (p) => paths.hostLogOf(p)));
      return new HostExtension((cwd) => connect.execute(cwd), this.#select);
    });
  }

  // La captura se registra ANTES que el HostExtension: Pi espera cada
  // handler en orden de registro, y el de session_start del host emite
  // HOST_READY al terminar de conectar. Así el sink de la sesión ya existe
  // cuando llega HOST_READY (el flush vacía lo que esperaba en el spool,
  // empezando por session.opened) y ningún PHASE_CHANGED llega sin sesión.
  static host(pi: PiExtensionApi): void {
    const host = this.#shared();
    const paths = new StatePaths(process.env); const locator = new GitProjectLocator();
    new EventCaptureExtension(
      (cwd) => new HostFactSink(() => host.gateway(), new FsFactSpool(paths.spoolDirOf(locator.locate(cwd)), process.pid)),
      new PiEventFactMapper(`pi:${process.pid}`, PackageInfo.version()),
    ).register(pi);
    host.register(pi);
  }

  static server(pi: PiExtensionApi, server: ServerName, toSchema: (json: Record<string, unknown>) => unknown): void {
    new ServerToolsExtension(server, this.#shared(), new PiToolFactory(toSchema)).register(pi);
  }
}
