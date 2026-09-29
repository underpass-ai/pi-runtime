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
import { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Clock } from "../ports/Clock.ts";
import type { HostLog } from "../ports/HostLog.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import type { IssuedGrants } from "../services/IssuedGrants.ts";
import type { MadeFactFactory } from "../services/MadeFactFactory.ts";
import type { MadeOwner } from "../services/MadeOwner.ts";
import type { PendingConfirmations } from "../services/PendingConfirmations.ts";
import type { RecordFact } from "./RecordFact.ts";

type Deps = {
  connection: () => Promise<McpConnection>; owner: MadeOwner; policy: MadeActionPolicy; confirmations: PendingConfirmations; grants: IssuedGrants;
  record: RecordFact; facts: MadeFactFactory; clock: Clock; log: HostLog | null;
};

// S3a §2: el host como punto de control de la autorización de MADE. Llama; si MADE deniega,
// lee la decisión (acción y alcance exactos) y, si la clase y la fase lo permiten, emite un
// grant exacto y reintenta UNA vez (auto), o pide confirmación humana (confirm). Con el token
// de una confirmación aceptada, emite el grant de 5 min antes de llamar. Nunca hay bucles, y
// cualquier fallo del camino de autorización devuelve la denegación original.
export class CallMadeTool {
  readonly #d: Deps; readonly #inflight = new Map<string, Promise<MadeGrant | null>>();
  constructor(deps: Deps) { this.#d = deps; }

  async execute(tool: ToolName, args: Record<string, unknown>, context: MadeCallContext | null): Promise<ToolOutcome | PendingConfirmation> {
    const d = this.#d;
    const digest = context === null ? null : CallDigest.of(context.session, tool, args);
    if (context !== null && context.token !== null) {
      const accepted = d.confirmations.redeem(context.token, context.session, tool, digest!);
      if (accepted !== null) {
        this.#audit(() => d.record.execute(d.facts.confirmation(accepted, ConfirmationOutcome.ACCEPTED)));
        const ensured = await this.#ensure(context.session, accepted.action, accepted.scope, MadeActionClass.CONFIRM);
        const first = await this.#call(tool, args);
        // Si el grant venía de la caché y MADE ya no lo honra, se desaloja y se emite otro: un
        // único reintento, para que la aceptación del usuario no se pierda en una entrada muerta.
        if (ensured === null || !ensured.cached || !CallMadeTool.#madeDenial(first)) return first;
        d.grants.evict(context.session, accepted.action, accepted.scope);
        return (await this.#ensure(context.session, accepted.action, accepted.scope, MadeActionClass.CONFIRM)) === null ? first : this.#call(tool, args);
      }
    }
    const outcome = await this.#call(tool, args);
    if (context === null || !(outcome instanceof ToolRefusal)) return outcome;
    const denied = MadeDecisionId.fromDenial(outcome.message);
    const actionClass = d.policy.admits(tool, context.phase);
    if (denied === null || actionClass === null) return outcome;
    const decision = await d.owner.decision(denied);
    if (decision === null || !decision.denied() || !this.#withinClass(decision.action, actionClass)) return outcome;
    if (actionClass.equals(MadeActionClass.CONFIRM)) return d.confirmations.open(context.session, tool, digest!, decision.action, decision.scope);
    const ensured = await this.#ensure(context.session, decision.action, decision.scope, MadeActionClass.AUTO);
    if (ensured === null) return outcome;
    const retried = await this.#call(tool, args);
    // Un grant de la caché que MADE ya no honra se desaloja; la denegación vuelve tal cual y la
    // siguiente llamada emite otro. Nunca un segundo reintento.
    if (ensured.cached && CallMadeTool.#madeDenial(retried)) d.grants.evict(context.session, decision.action, decision.scope);
    return retried;
  }

  async #call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> { return (await this.#d.connection()).call(tool, args); }

  static #madeDenial(outcome: ToolOutcome): boolean { return outcome instanceof ToolRefusal && MadeDecisionId.fromDenial(outcome.message) !== null; }

  // Defensa en profundidad: la acción de la decisión no puede ser más estricta que la clase de la
  // tool llamada (una tool auto sólo concede acciones auto; una confirm, nunca una never).
  #withinClass(action: MadeAction, actionClass: MadeActionClass): boolean {
    const own = this.#d.policy.classify(ToolName.of(`made_${action.value}`));
    if (own.equals(MadeActionClass.NEVER)) return false;
    return actionClass.equals(MadeActionClass.CONFIRM) || own.equals(MadeActionClass.AUTO);
  }

  // Un grant vigente de esta sesión para la acción y el alcance, emitido si hace falta, o null si
  // no se pudo (ya avisado en el log). `cached` dice si salió de la caché. Dos llamadas a la vez
  // comparten la misma emisión (y un único aviso). Si el hecho no se puede registrar (la sesión
  // no está abierta en el log), el grant se revoca en el acto: nunca queda uno sin auditar, y si
  // la revocación también falla se avisa de que sigue vivo.
  async #ensure(session: SessionId, action: MadeAction, scope: MadeScope, actionClass: MadeActionClass): Promise<{ grant: MadeGrant; cached: boolean } | null> {
    const d = this.#d;
    const cached = d.grants.covering(session, action, scope, d.clock.now());
    if (cached !== null) return { grant: cached, cached: true };
    const key = `${session.value}\n${action.value}\n${scope.key}`;
    let issuing = this.#inflight.get(key);
    if (issuing === undefined) {
      issuing = this.#issue(session, action, scope, actionClass);
      this.#inflight.set(key, issuing);
      const running = issuing;
      const done = () => { if (this.#inflight.get(key) === running) this.#inflight.delete(key); };
      running.then(done, done);
    }
    const grant = await issuing;
    return grant === null ? null : { grant, cached: false };
  }

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
    d.grants.add(grant);
    return grant;
  }

  #audit(fn: () => void): void { try { fn(); } catch (e) { this.#warn("made audit fact not recorded", null, e); } }

  #warn(message: string, action: MadeAction | null, e: unknown, grant: string | null = null): void {
    const reason = e instanceof ToolRefusal ? e.code.value : e instanceof Error ? e.name : "unknown";
    this.#d.log?.warn(message, grant === null ? { action: action?.value ?? null, reason } : { action: action?.value ?? null, reason, grant });
  }
}
