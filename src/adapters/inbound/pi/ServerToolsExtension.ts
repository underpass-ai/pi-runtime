import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import { Phase } from "../../../domain/session/Phase.ts";
import { HOST_READY, type HostExtension } from "./HostExtension.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";
import type { PiToolFactory } from "./PiToolFactory.ts";

export class ServerToolsExtension {
  readonly #server: ServerName; readonly #host: HostExtension; readonly #tools: PiToolFactory;
  #registered = false; #registering: Promise<void> | null = null;
  constructor(server: ServerName, host: HostExtension, tools: PiToolFactory) { this.#server = server; this.#host = host; this.#tools = tools; }

  register(pi: PiExtensionApi): void {
    pi.events.on(HOST_READY, () => {
      if (this.#registered || this.#registering) return;
      this.#registering = (async () => {
        try {
          const catalog = await (await this.#host.gateway()).catalog(this.#server);
          for (const t of catalog.tools()) pi.registerTool(this.#tools.create(this.#server, t, () => this.#host.gateway(), () => this.#host.callContext()));
          this.#host.applyPhase(pi, Phase.INTERACTIVE);
          this.#registered = true;
        } catch (e) {
          const message = (e as Error).message;
          pi.events.emit("underpass:catalog-failed", { server: this.#server.value, message });
          console.error(`Underpass catalog failed for ${this.#server.value}: ${message}`);
        } finally {
          this.#registering = null;
        }
      })();
    });
  }
}
