import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import { Phase } from "../../../domain/session/Phase.ts";
import { HOST_READY, type HostExtension } from "./HostExtension.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";
import type { PiToolFactory } from "./PiToolFactory.ts";

export class ServerToolsExtension {
  readonly #server: ServerName; readonly #host: HostExtension; readonly #tools: PiToolFactory; #registered = false;
  constructor(server: ServerName, host: HostExtension, tools: PiToolFactory) { this.#server = server; this.#host = host; this.#tools = tools; }

  register(pi: PiExtensionApi): void {
    pi.events.on(HOST_READY, async () => {
      if (this.#registered) return;
      this.#registered = true;
      const catalog = await (await this.#host.gateway()).catalog(this.#server);
      for (const t of catalog.tools()) pi.registerTool(this.#tools.create(this.#server, t, () => this.#host.gateway()));
      this.#host.applyPhase(pi, Phase.INTERACTIVE);
    });
  }
}
