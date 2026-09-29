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
import type { ToolName } from "../../domain/mcp/ToolName.ts";
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
  readonly #d: Deps; readonly #inflight = new Map<string, Promise<MadeGrant>>();
  constructor(deps: Deps) { this.#d = deps; }

  async execute(tool: ToolName, args: Record<string, unknown>, context: MadeCallContext | null): Promise<ToolOutcome | PendingConfirmation> {
    const d = this.#d;
    const digest = context === null ? null : CallDigest.of(context.session, tool, args);
    if (context !== null && context.token !== null) {
      const accepted = d.confirmations.redeem(context.token, context.session, tool, digest!);
      if (accepted !== null) {
        this.#audit(() => d.record.execute(d.facts.confirmation(accepted, ConfirmationOutcome.ACCEPTED)));
        try { await this.#ensure(context.session, accepted.action, accepted.scope, MadeActionClass.CONFIRM); }
        catch (e) { this.#warn("made grant not issued", accepted.action, e); }
        return this.#call(tool, args);
      }
    }
    const outcome = await this.#call(tool, args);
    if (context === null || !(outcome instanceof ToolRefusal)) return outcome;
    const denied = MadeDecisionId.fromDenial(outcome.message);
    const actionClass = d.policy.admits(tool, context.phase);
    if (denied === null || actionClass === null) return outcome;
    const decision = await d.owner.decision(denied);
    if (decision === null || !decision.denied()) return outcome;
    if (actionClass.equals(MadeActionClass.CONFIRM)) return d.confirmations.open(context.session, tool, digest!, decision.action, decision.scope);
    try { await this.#ensure(context.session, decision.action, decision.scope, MadeActionClass.AUTO); }
    catch (e) { this.#warn("made grant not issued", decision.action, e); return outcome; }
    return this.#call(tool, args);
  }

  async #call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> { return (await this.#d.connection()).call(tool, args); }

  // Un grant vigente de esta sesión para la acción y el alcance, emitido si hace falta. Dos
  // llamadas a la vez comparten la misma emisión. Si el hecho no se puede registrar (la sesión
  // no está abierta en el log), el grant se revoca en el acto: nunca queda uno sin auditar.
  async #ensure(session: SessionId, action: MadeAction, scope: MadeScope, actionClass: MadeActionClass): Promise<MadeGrant> {
    const d = this.#d;
    const cached = d.grants.covering(session, action, scope, d.clock.now());
    if (cached !== null) return cached;
    const key = `${session.value}\n${action.value}\n${scope.key}`;
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const issuing = (async () => {
      const grant = MadeGrant.issue(session, action, scope, actionClass, d.clock.now());
      await d.owner.issue(grant);
      try { d.record.execute(d.facts.grantIssued(grant)); }
      catch (e) { await d.owner.revoke(grant.id, RevocationReason.SESSION_CLOSED).catch(() => undefined); throw e; }
      d.grants.add(grant);
      return grant;
    })();
    this.#inflight.set(key, issuing);
    try { return await issuing; } finally { this.#inflight.delete(key); }
  }

  #audit(fn: () => void): void { try { fn(); } catch (e) { this.#warn("made audit fact not recorded", null, e); } }

  #warn(message: string, action: MadeAction | null, e: unknown): void {
    const reason = e instanceof ToolRefusal ? e.code.value : e instanceof Error ? e.name : "unknown";
    this.#d.log?.warn(message, { action: action?.value ?? null, reason });
  }
}
