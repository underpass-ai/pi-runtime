import type { SelectionDto } from "../../../application/dto/SelectionDto.ts";
import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { SelectPhaseTools } from "../../../application/use-cases/SelectPhaseTools.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import { ServerName } from "../../../domain/mcp/ServerName.ts";
import { ToolName } from "../../../domain/mcp/ToolName.ts";
import { Phase } from "../../../domain/session/Phase.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";

export const HOST_READY = "underpass:host-ready";
export const PHASE_CHANGED = "underpass:phase-changed";
const isOurs = (n: string) => n.startsWith("kmp_") || n.startsWith("made_");
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(0)}%`);
// L1 (spec §7): Pi nunca espera más de esto a la decisión del host.
const SELECT_TIMEOUT_MS = 200;

export class HostExtension {
  readonly #connect: (cwd: string) => Promise<HostGateway>; readonly #select: SelectPhaseTools; readonly #selectTimeoutMs: number;
  #gateway: Promise<HostGateway> | null = null; #cwd: string | null = null;
  // L1: sesión y fase en curso, última fase decidida y si las tools activas están reducidas.
  #sessionId: string | null = null; #phase: Phase = Phase.INTERACTIVE; #decidedPhase: string | null = null; #narrowed = false;

  constructor(connect: (cwd: string) => Promise<HostGateway>, select: SelectPhaseTools, selectTimeoutMs = SELECT_TIMEOUT_MS) {
    this.#connect = connect; this.#select = select; this.#selectTimeoutMs = selectTimeoutMs;
  }

  // Si el host muere, el gateway se descarta al cerrarse y la siguiente
  // llamada reconecta perezosamente con la misma función de conexión (que
  // relanza el host si no hay nadie escuchando).
  gateway(): Promise<HostGateway> {
    if (this.#gateway) return this.#gateway;
    if (this.#cwd === null) return Promise.reject(new Error("Underpass host not connected yet"));
    return this.#open(this.#cwd);
  }

  #open(cwd: string): Promise<HostGateway> {
    const opening: Promise<HostGateway> = this.#connect(cwd).then((g) => {
      g.onClose(() => { if (this.#gateway === opening) this.#gateway = null; });
      return g;
    });
    opening.catch(() => { if (this.#gateway === opening) this.#gateway = null; });
    this.#gateway = opening;
    return opening;
  }

  applyPhase(pi: PiExtensionApi, phase: Phase): void {
    this.#phase = phase; this.#narrowed = false;
    pi.setActiveTools(this.#phaseTools(pi, phase));
    pi.events.emit(PHASE_CHANGED, { phase: phase.value, activeTools: pi.getActiveTools() });
  }

  // Todas las tools de la fase: las de Pi activas y las nuestras registradas que la fase permite.
  #phaseTools(pi: PiExtensionApi, phase: Phase): string[] {
    const ours = pi.getAllTools().map((t) => t.name).filter(isOurs).map((n) => ToolName.of(n));
    const foreign = pi.getActiveTools().filter((n) => !isOurs(n));
    return this.#select.execute(phase, ours, foreign);
  }

  // Decisión de L1 en agent_start y en cada cambio de fase. Sólo `active` sin control reduce
  // las tools de la fase a floor ∪ selected (más las de Pi); cualquier otra respuesta, un
  // error (también una negativa `ok:false`, que llega como HostCallError de otro realm), un
  // host caído o más de 200 ms dejan el conjunto completo de la fase (y lo restauran si una
  // decisión anterior lo había reducido). Si conectar con el host agota el plazo, el select
  // ya no se envía: no queda registrada una decisión que Pi no aplicó. Nunca lanza.
  async learn(pi: PiExtensionApi): Promise<void> {
    const sid = this.#sessionId; const phase = this.#phase;
    if (sid === null) return;
    let expired = false;
    const selection = await this.#bounded(this.gateway().then((g) => (expired ? null : g.select(SessionId.of(sid), phase))), () => { expired = true; });
    // Phase puede venir de otro realm de jiti (kmp.ts, made.ts): se compara por valor.
    if (sid !== this.#sessionId || phase.value !== this.#phase.value) return;
    try {
      if (selection !== null && selection.mode === "active" && !selection.control) {
        const keep = new Set([...selection.floor, ...selection.selected]);
        pi.setActiveTools(this.#phaseTools(pi, phase).filter((n) => !isOurs(n) || keep.has(n)));
        this.#narrowed = true;
      } else if (this.#narrowed) {
        pi.setActiveTools(this.#phaseTools(pi, phase));
        this.#narrowed = false;
      }
    } catch { /* L1 nunca rompe Pi */ }
  }

  async #bounded(selection: Promise<SelectionDto | null>, expire: () => void): Promise<SelectionDto | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => { expire(); resolve(null); }, this.#selectTimeoutMs); });
    try { return await Promise.race([selection.catch(() => null), timeout]); }
    finally { clearTimeout(timer); }
  }

  register(pi: PiExtensionApi): void {
    pi.on("session_start", async (_e, ctx) => {
      this.#sessionId = ctx.sessionManager?.getSessionId() ?? null; this.#decidedPhase = null; this.#narrowed = false;
      const previous = this.#gateway;
      this.#gateway = null;
      if (previous) (await previous.catch(() => null))?.close();
      this.#cwd = ctx.cwd;
      try { await this.#open(ctx.cwd); pi.events.emit(HOST_READY, null); }
      catch (e) {
        const message = `Underpass host unavailable: ${(e as Error).message}`;
        if (ctx.hasUI) ctx.ui.notify(message, "error"); else console.error(message);
      }
    });
    pi.on("session_shutdown", async () => {
      this.#sessionId = null;
      const g = this.#gateway; this.#gateway = null; this.#cwd = null;
      if (g) (await g.catch(() => null))?.close();
    });
    // Una decisión por petición del usuario (no por llamada al LLM) y otra por cambio de fase;
    // applyPhase emite PHASE_CHANGED una vez por servidor al registrar: sólo cuenta si la fase cambia.
    pi.on("agent_start", async () => { await this.learn(pi); });
    pi.events.on(PHASE_CHANGED, (d) => {
      const phase = String((d as { phase?: unknown } | null)?.phase);
      if (phase === this.#decidedPhase) return;
      this.#decidedPhase = phase;
      void this.learn(pi);
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
        const sid = ctx.sessionManager?.getSessionId();
        if (sid) {
          try {
            const status = await g.summary(SessionId.of(sid)); const s = status.summary;
            if (s) lines.push(`session: ${s.turns} turns, ${s.tokens.input}+${s.tokens.output} tokens, $${s.cost.toFixed(4)}, ${Object.entries(s.calls).map(([k, v]) => `${k} ${Object.entries(v).map(([st, n]) => `${st}:${n}`).join("/")}`).join(", ") || "no calls"}, failures ${s.failures}`);
            lines.push(`log: position ${status.logPosition}, session chain ${status.sessionChainIntact ? "intact" : "BROKEN"}`);
            const k = status.kpis;
            if (k) lines.push(`kpis: first-try ${pct(k.firstTrySuccess)}, refusals ${pct(k.refusalRate)}, cache ${pct(k.cacheRatio)}, compactions ${k.compactions}`);
            const x = status.exporter;
            if (x) lines.push(x.state === "disabled" ? "otlp: disabled" : x.state === "ok" ? `otlp: ok, lag ${x.lag}` : `otlp: failing since ${x.since}`);
          } catch { lines.push("session: summary unavailable"); }
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
