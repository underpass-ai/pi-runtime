import { test } from "node:test";
import assert from "node:assert/strict";
import { install, madeFacts, record, skip, start, stop, t, waitFor } from "./made-host-support.ts";
import type { CallContextDto } from "../../src/application/dto/CallContextDto.ts";
import { HostCallError } from "../../src/application/ports/HostCallError.ts";
import type { UnixSocketHostGateway } from "../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { SessionId } from "../../src/domain/events/SessionId.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";

// F3 contra made-mcp 0.8.0 real, por el host real: una ceremonia mínima de dos pasos host_callback
// diseñada y publicada en la misma sesión, arrancada en la fase run con UNA confirmación y llevada
// a su terminal sin más preguntas (reclamar, completar, transición, dos veces).
const DESIGN = { name: "pi_runtime_run_smoke", objective: "Smoke-test running a published ceremony from Pi.", required_inputs: ["brief"], outputs: ["verdict"],
  participants: [{ role_id: "REVIEWER" }], stages: [{ id: "draft", owner_role_id: "REVIEWER", instructions: "Draft a verdict." }, { id: "review", owner_role_id: "REVIEWER", instructions: "Confirm the verdict." }] };
type Instance = { ceremony_id: string; lifecycle: string; end_reason: string | null; claimable_step_ids: string[]; claim_fence?: string; transitions: { trigger: string; enabled: boolean }[] };

const confirmThen = async (gw: UnixSocketHostGateway, tool: string, args: Record<string, unknown>, ctx: CallContextDto) => {
  let token = "";
  await assert.rejects(gw.call(ServerName.MADE, t(tool), args, ctx), (e) => HostCallError.is(e) && e.code === "needs_confirmation" && (token = e.confirmation!.token) !== "");
  return gw.call(ServerName.MADE, t(tool), args, { ...ctx, confirmation: token });
};

test("made-mcp 0.8.0: fase run, una sola confirmación al arrancar y la ceremonia llega a su terminal; grants de instancia revocados", { skip, timeout: 180_000 }, async () => {
  const i = install();
  const h = await start(i);
  try {
    await record(h.gw, "s1", "session.opened", "o");
    await record(h.gw, "s2", "session.opened", "o");
    const design: CallContextDto = { sessionId: "s1", phase: "design" };
    const run: CallContextDto = { sessionId: "s1", phase: "run" };
    const designed = (await h.gw.call(ServerName.MADE, t("made_design_ceremony"), DESIGN, design)).structured as { definition_yaml: string };
    assert.equal(((await confirmThen(h.gw, "made_publish_ceremony_definition", { definition_yaml: designed.definition_yaml }, design)).structured as { outcome: string }).outcome, "published");

    // Arrancar: en design no se concede; sin ceremony_id, el host dice qué falta.
    const startArgs = { ceremony: "pi_runtime_run_smoke", version: "1.0", ceremony_id: "run-smoke-1", actor_id: "pi:contract", actor_kind: "agent", context: { brief: "contract" } };
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_start_published_ceremony"), startArgs, design), (e) => HostCallError.is(e) && /denied the operation/.test(e.message));
    const { ceremony_id: _, ...bare } = startArgs;
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_start_published_ceremony"), bare, run), (e) => HostCallError.is(e) && e.code === "invalid_arguments");
    // Cada needs_confirmation es una pregunta en la TUI: se cuentan todas las de la ejecución.
    let asked = 0;
    const call = async (tool: string, args: Record<string, unknown>, ctx: CallContextDto) => {
      try { return await h.gw.call(ServerName.MADE, t(tool), args, ctx); }
      catch (e) {
        if (!HostCallError.is(e) || e.code !== "needs_confirmation") throw e;
        asked++;
        assert.deepEqual({ action: e.confirmation!.action, scopeSummary: e.confirmation!.scopeSummary }, { action: "start_published_ceremony", scopeSummary: "ceremony run-smoke-1" });
        return h.gw.call(ServerName.MADE, t(tool), args, { ...ctx, confirmation: e.confirmation!.token });
      }
    };
    let instance = (await call("made_start_published_ceremony", startArgs, run)).structured as Instance;
    assert.equal(instance.lifecycle, "running");

    // Otra sesión no hereda nada: sobre esta instancia, reclamar sigue pidiendo confirmación.
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_claim_ceremony_step"), { ceremony_id: "run-smoke-1", step_id: instance.claimable_step_ids[0], actor_kind: "agent" }, { sessionId: "s2", phase: "run" }),
      (e) => HostCallError.is(e) && e.code === "needs_confirmation");
    // Fuera de run, las escrituras de ejecución ni llegan a MADE.
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_claim_ceremony_step"), { ceremony_id: "run-smoke-1", step_id: "draft", actor_kind: "agent" }, design),
      (e) => HostCallError.is(e) && e.code === "out_of_phase");

    // El agente de Pi hace cada paso host_callback y aplica la transición habilitada, sin preguntas.
    const done: string[] = [];
    for (let round = 0; round < 10 && instance.lifecycle !== "ended"; round++) {
      const step = instance.claimable_step_ids[0];
      if (step !== undefined) {
        const claimed = (await call("made_claim_ceremony_step", { ceremony_id: "run-smoke-1", step_id: step, actor_kind: "agent" }, run)).structured as Instance;
        instance = (await call("made_complete_ceremony_step", { ceremony_id: "run-smoke-1", step_id: step, actor_kind: "agent", status: "completed",
          claim_fence: claimed.claim_fence, output: { verdict: { ok: true, step } } }, run)).structured as Instance;
        done.push(step);
        continue;
      }
      const enabled = instance.transitions.find((x) => x.enabled);
      assert.ok(enabled, "sin paso reclamable, alguna transición está habilitada");
      instance = (await call("made_apply_ceremony_transition", { ceremony_id: "run-smoke-1", trigger: enabled.trigger, actor_kind: "agent" }, run)).structured as Instance;
      done.push(enabled.trigger);
    }
    assert.deepEqual({ lifecycle: instance.lifecycle, end: instance.end_reason }, { lifecycle: "ended", end: "completed" });
    assert.deepEqual(done, ["draft", "draft_completed", "review", "review_completed"]);
    assert.equal(asked, 1, "una sola confirmación en toda la ejecución");
    const read = (await call("made_get_ceremony_instance", { ceremony_id: "run-smoke-1" }, run)).structured as Instance;
    assert.equal(read.lifecycle, "ended");

    // Auditoría: el arranque y el terminal, grants de alcance a la instancia y su revocación al terminal.
    const facts = madeFacts(i.log);
    const s1 = facts.filter((f) => f.stream === "session:s1");
    assert.deepEqual(s1.filter((f) => f.type === "made.ceremony_started").map((f) => f.payload), [{ ceremonyId: "run-smoke-1", definition: "pi_runtime_run_smoke", version: "1.0" }]);
    assert.deepEqual(s1.filter((f) => f.type === "made.ceremony_ended").map((f) => f.payload), [{ ceremonyId: "run-smoke-1", endReason: "completed" }]);
    const instanceGrants = s1.filter((f) => f.type === "made.grant_issued" && (f.payload.scope as { ceremony_id?: string }).ceremony_id === "run-smoke-1");
    assert.deepEqual(instanceGrants.map((f) => [f.payload.action, f.payload.class]).sort(), [["apply_ceremony_transition", "auto"], ["claim_ceremony_step", "auto"], ["get_ceremony_instance", "auto"], ["start_published_ceremony", "confirm"]]);
    const revoked = new Map(facts.filter((f) => f.type === "made.grant_revoked").map((f) => [f.payload.grantId, f.payload.reason]));
    // La lectura tras el terminal se concede como cualquier lectura (auto hasta el cierre de la sesión).
    const readGrant = instanceGrants.find((g) => g.payload.action === "get_ceremony_instance")!;
    assert.equal(revoked.get(readGrant.payload.grantId), undefined);
    for (const g of instanceGrants.filter((x) => x !== readGrant)) assert.equal(revoked.get(g.payload.grantId), g.payload.action === "start_published_ceremony" ? "consumed" : "ceremony_ended", String(g.payload.action));
    const policy = await i.policy();
    for (const g of instanceGrants.filter((x) => x.payload.action !== "start_published_ceremony" && x !== readGrant)) assert.ok(policy.revocations.includes(g.payload.grantId as string), "revocado también en MADE");

    // Tras el terminal, otra escritura sobre la instancia vuelve a pedir confirmación.
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_claim_ceremony_step"), { ceremony_id: "run-smoke-1", step_id: "draft", actor_kind: "agent" }, run),
      (e) => HostCallError.is(e) && e.code === "needs_confirmation");

    // El estado de la sesión lo cuenta.
    const made = (await h.gw.summary(SessionId.of("s1"))).made;
    assert.deepEqual(made?.ceremonies?.map((c) => [c.summary, c.state, c.endReason]), [["ceremony run-smoke-1 (pi_runtime_run_smoke v1.0)", "ended", "completed"]]);

    await record(h.gw, "s1", "session.closed", "c");
    await waitFor(() => madeFacts(i.log).some((f) => f.type === "made.grant_revoked" && f.payload.grantId === readGrant.payload.grantId && f.payload.reason === "session_closed"));
  } finally { await stop(h); i.cleanup(); }
});
