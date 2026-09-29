import type { SessionId } from "../../domain/events/SessionId.ts";
import { CallDigest } from "../../domain/made/CallDigest.ts";
import { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import type { MadeAction } from "../../domain/made/MadeAction.ts";
import { MadeActionClass } from "../../domain/made/MadeActionClass.ts";
import type { MadeActionPolicy } from "../../domain/made/MadeActionPolicy.ts";
import type { MadeCallContext } from "../../domain/made/MadeCallContext.ts";
import { MadeDecisionId } from "../../domain/made/MadeDecisionId.ts";
import { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeScope } from "../../domain/made/MadeScope.ts";
import type { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import { RevocationReason } from "../../domain/made/RevocationReason.ts";
import { RefusalCode } from "../../domain/mcp/RefusalCode.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Clock } from "../ports/Clock.ts";
import type { HostLog } from "../ports/HostLog.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import type { MadeFactFactory } from "../services/MadeFactFactory.ts";
import type { MadeOwner } from "../services/MadeOwner.ts";
import type { PendingConfirmations } from "../services/PendingConfirmations.ts";
import type { RecordFact } from "./RecordFact.ts";

type Deps = {
  connection: () => Promise<McpConnection>; owner: MadeOwner; policy: MadeActionPolicy; confirmations: PendingConfirmations;
  record: RecordFact; facts: MadeFactFactory; clock: Clock; log: HostLog | null;
};

const RESERVED = RefusalCode.of("refused");

// S3a §2: el host como punto de control de la autorización de MADE. Las tools never (la
// administración de la autorización) nunca llegan a MADE por aquí: el host las usa como dueño a
// través de MadeOwner, no del IPC. Para el resto llama; si MADE deniega, lee la decisión (acción y
// alcance exactos) y, si la clase, la fase y el alcance lo permiten, emite un grant exacto y
// reintenta UNA vez (auto), o pide confirmación humana (confirm). Con el token de una
// confirmación aceptada, emite un grant de 5 min, hace esa llamada y lo revoca en cuanto vuelve
// (consumed): cubre sólo la llamada confirmada. Nunca hay bucles, y cualquier fallo del camino de
// autorización devuelve la denegación original.
export class CallMadeTool {
  readonly #d: Deps; readonly #inflight = new Map<string, Promise<MadeGrant | null>>();
  constructor(deps: Deps) { this.#d = deps; }

  async execute(tool: ToolName, args: Record<string, unknown>, context: MadeCallContext | null): Promise<ToolOutcome | PendingConfirmation> {
    const d = this.#d;
    if (d.policy.classify(tool).equals(MadeActionClass.NEVER)) return ToolRefusal.of(RESERVED, `${tool.value} is reserved to the pi-runtime host and never runs for a session`, false);
    const digest = context === null ? null : CallDigest.of(context.session, tool, args);
    if (context !== null && context.token !== null) {
      const accepted = d.confirmations.redeem(context.token, context.session, tool, digest!);
      if (accepted !== null) {
        this.#audit(() => d.record.execute(d.facts.confirmation(accepted, ConfirmationOutcome.ACCEPTED)));
        // La fase se vuelve a mirar al redimir: si ya no expone la tool, la denegación original.
        if (d.policy.admits(tool, context.phase) !== null) return this.#confirmed(accepted, tool, args);
      }
    }
    const outcome = await this.#call(tool, args);
    if (context === null || !(outcome instanceof ToolRefusal)) return outcome;
    const denied = MadeDecisionId.fromDenial(outcome);
    const actionClass = d.policy.admits(tool, context.phase);
    if (denied === null || actionClass === null) return outcome;
    const decision = await d.owner.decision(denied);
    if (decision === null || !decision.denied() || !this.#withinClass(decision.action, actionClass) || !d.policy.grantable(decision.action, decision.scope)) return outcome;
    if (actionClass.equals(MadeActionClass.CONFIRM)) return d.confirmations.open(context.session, tool, digest!, decision.action, decision.scope);
    // La denegación dice que ningún grant vigente la cubre (tampoco uno emitido antes y revocado
    // por fuera): se emite uno nuevo, compartido con las denegaciones simultáneas, y se reintenta.
    return (await this.#shared(context.session, decision.action, decision.scope)) === null ? outcome : this.#call(tool, args);
  }

  // El catálogo de MADE que ve Pi: sin las tools never, que sólo usa el host como dueño.
  exposed(catalog: ToolCatalog): ToolCatalog { return catalog.filter((n) => this.#d.policy.exposable(n)); }

  async #call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> { return (await this.#d.connection()).call(tool, args); }

  // La llamada confirmada, con su propio grant de 5 min que se revoca al volver, vaya como vaya.
  // Si no se pudo emitir, la llamada sigue y MADE la deniega: sin bucle.
  async #confirmed(accepted: PendingConfirmation, tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
    const grant = await this.#issue(accepted.session, accepted.action, accepted.scope, MadeActionClass.CONFIRM);
    if (grant === null) return this.#call(tool, args);
    try { return await this.#call(tool, args); }
    finally { await this.#consume(grant); }
  }

  async #consume(grant: MadeGrant): Promise<void> {
    const d = this.#d;
    try { await d.owner.revoke(grant.id, RevocationReason.CONSUMED); }
    catch (e) { this.#warn("made grant not revoked", grant.action, e, grant.id.value); return; }
    this.#audit(() => d.record.execute(d.facts.grantRevoked(grant.id, grant.session, RevocationReason.CONSUMED)));
  }

  // Defensa en profundidad: la acción de la decisión no puede ser más estricta que la clase de la
  // tool llamada (una tool auto sólo concede acciones auto; una confirm, nunca una never).
  #withinClass(action: MadeAction, actionClass: MadeActionClass): boolean {
    const own = this.#d.policy.classify(ToolName.of(`made_${action.value}`));
    if (own.equals(MadeActionClass.NEVER)) return false;
    return actionClass.equals(MadeActionClass.CONFIRM) || own.equals(MadeActionClass.AUTO);
  }

  // Un grant auto de esta sesión para la acción y el alcance, o null si no se pudo (ya avisado en
  // el log). Dos denegaciones a la vez comparten la misma emisión (y un único aviso).
  #shared(session: SessionId, action: MadeAction, scope: MadeScope): Promise<MadeGrant | null> {
    const key = `${session.value}\n${action.value}\n${scope.key}`;
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const issuing = this.#issue(session, action, scope, MadeActionClass.AUTO);
    this.#inflight.set(key, issuing);
    const done = () => { if (this.#inflight.get(key) === issuing) this.#inflight.delete(key); };
    issuing.then(done, done);
    return issuing;
  }

  // Emite el grant y registra el hecho. Si el hecho no se puede registrar (la sesión no está
  // abierta en el log), el grant se revoca en el acto: nunca queda uno sin auditar, y si la
  // revocación también falla se avisa de que sigue vivo.
  async #issue(session: SessionId, action: MadeAction, scope: MadeScope, actionClass: MadeActionClass): Promise<MadeGrant | null> {
    const d = this.#d;
    const grant = MadeGrant.issue(session, action, scope, actionClass, d.clock.now());
    try { await d.owner.issue(grant); }
    catch (e) { this.#warn("made grant not issued", action, e); return null; }
    try { d.record.execute(d.facts.grantIssued(grant)); }
    catch (e) {
      try { await d.owner.revoke(grant.id, RevocationReason.SESSION_CLOSED); }
      catch (r) { this.#warn("made grant not revoked", action, r, grant.id.value); return null; }
      this.#warn("made grant not issued", action, e);
      return null;
    }
    return grant;
  }

  #audit(fn: () => void): void { try { fn(); } catch (e) { this.#warn("made audit fact not recorded", null, e); } }

  #warn(message: string, action: MadeAction | null, e: unknown, grant: string | null = null): void {
    const reason = e instanceof ToolRefusal ? e.code.value : e instanceof Error ? e.name : "unknown";
    this.#d.log?.warn(message, grant === null ? { action: action?.value ?? null, reason } : { action: action?.value ?? null, reason, grant });
  }
}
