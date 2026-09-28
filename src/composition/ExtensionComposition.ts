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
import { StatePaths } from "./StatePaths.ts";

export class ExtensionComposition {
  static #host: HostExtension | null = null;
  static #select = new SelectPhaseTools(PhaseToolSelection.standard());

  static #shared(): HostExtension {
    if (!this.#host) {
      const paths = new StatePaths(process.env);
      const connect = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p),
        new DetachedHostLauncher(new URL("../../bin/underpass-host.ts", import.meta.url).pathname, process.env));
      this.#host = new HostExtension((cwd) => connect.execute(cwd), this.#select);
    }
    return this.#host;
  }

  static host(pi: PiExtensionApi): void { this.#shared().register(pi); }

  static server(pi: PiExtensionApi, server: ServerName, toSchema: (json: Record<string, unknown>) => unknown): void {
    new ServerToolsExtension(server, this.#shared(), new PiToolFactory(toSchema)).register(pi);
  }
}
