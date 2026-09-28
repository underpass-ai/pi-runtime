import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { SelectPhaseTools } from "../../../application/use-cases/SelectPhaseTools.ts";
import { ServerName } from "../../../domain/mcp/ServerName.ts";
import { ToolName } from "../../../domain/mcp/ToolName.ts";
import { Phase } from "../../../domain/session/Phase.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";

export const HOST_READY = "underpass:host-ready";
const isOurs = (n: string) => n.startsWith("kmp_") || n.startsWith("made_");

export class HostExtension {
  readonly #connect: (cwd: string) => Promise<HostGateway>; readonly #select: SelectPhaseTools;
  #gateway: Promise<HostGateway> | null = null;

  constructor(connect: (cwd: string) => Promise<HostGateway>, select: SelectPhaseTools) { this.#connect = connect; this.#select = select; }

  gateway(): Promise<HostGateway> {
    if (!this.#gateway) return Promise.reject(new Error("Underpass host not connected yet"));
    return this.#gateway;
  }

  applyPhase(pi: PiExtensionApi, phase: Phase): void {
    const ours = pi.getAllTools().map((t) => t.name).filter(isOurs).map((n) => ToolName.of(n));
    const foreign = pi.getActiveTools().filter((n) => !isOurs(n));
    pi.setActiveTools(this.#select.execute(phase, ours, foreign));
  }

  register(pi: PiExtensionApi): void {
    pi.on("session_start", async (_e, ctx) => {
      this.#gateway = this.#connect(ctx.cwd);
      try { await this.#gateway; pi.events.emit(HOST_READY, null); }
      catch (e) { this.#gateway = null; if (ctx.hasUI) ctx.ui.notify(`Underpass host unavailable: ${(e as Error).message}`, "error"); }
    });
    pi.on("session_shutdown", async () => {
      const g = this.#gateway; this.#gateway = null;
      if (g) (await g.catch(() => null))?.close();
    });
    pi.registerCommand("underpass-status", {
      description: "Show Underpass host, servers and catalog fingerprints",
      handler: async (_a, ctx) => {
        const g = await this.gateway();
        const h = await g.health();
        const lines = [`project: ${h.project}`, `servers: ${h.started.join(", ") || "none started"}`];
        for (const s of h.started) {
          const c = await g.catalog(ServerName.of(s));
          lines.push(`${s} ${c.identity.version}: ${c.names().length} tools, ${c.fingerprint().short()}`);
        }
        ctx.ui.notify(lines.join("\n"), "info");
      },
    });
    pi.registerCommand("underpass-phase", {
      description: "Switch active Underpass tools: interactive | design",
      getArgumentCompletions: (p) => ["interactive", "design"].filter((x) => x.startsWith(p)).map((x) => ({ value: x, label: x })),
      handler: async (args, ctx) => {
        const phase = Phase.of(args.trim() || "interactive");
        this.applyPhase(pi, phase);
        ctx.ui.notify(`Underpass phase: ${phase}`, "info");
      },
    });
  }
}
