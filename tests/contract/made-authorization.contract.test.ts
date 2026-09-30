import { test } from "node:test";
import assert from "node:assert/strict";
import { install, madeFacts, record, skip, start, stop, t, waitFor } from "./made-host-support.ts";
import { SqliteMadePolicyCensus } from "../../src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts";
import { SqliteDatabase } from "../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SystemClock } from "../../src/adapters/outbound/clock/SystemClock.ts";
import type { CallContextDto } from "../../src/application/dto/CallContextDto.ts";
import { HostCallError } from "../../src/application/ports/HostCallError.ts";
import { RecordFact } from "../../src/application/use-cases/RecordFact.ts";
import { SessionId } from "../../src/domain/events/SessionId.ts";
import { StreamId } from "../../src/domain/events/StreamId.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import { fact } from "../support/recordFixtures.ts";

const DESIGN = { name: "s3a_contract", objective: "Review a change.", required_inputs: ["brief"], outputs: ["verdict"], participants: [{ role_id: "REVIEWER" }],
  stages: [{ id: "review", owner_role_id: "REVIEWER", instructions: "Review it." }] };

test("made-mcp 0.9.0 por el host real: lecturas automáticas, publicar con confirmación, rechazo, revocación al cerrar", { skip, timeout: 120_000 }, async () => {
  const i = install();
  const h = await start(i);
  try {
    const ctx: CallContextDto = { sessionId: "s1", phase: "design" };
    await record(h.gw, "s1", "session.opened", "o");

    // Sin contexto (una extensión anterior) nada cambia: la denegación original de MADE.
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_list_contracts"), {}), (e) => HostCallError.is(e) && e.code === "refused" && /denied the operation/.test(e.message));

    // Las tools never nunca llegan a MADE por el host, con o sin contexto, y Pi no las ve en el catálogo.
    for (const c of [undefined, ctx]) {
      await assert.rejects(h.gw.call(ServerName.MADE, t("made_get_authorization_policy"), {}, c), (e) => HostCallError.is(e) && e.code === "refused" && /reserved to the pi-runtime host/.test(e.message));
    }
    const names = (await h.gw.catalog(ServerName.MADE)).names().map(String);
    assert.ok(names.includes("made_publish_ceremony_definition"));
    for (const never of ["made_get_authorization_policy", "made_list_authorization_decisions", "made_issue_authorization_grant", "made_revoke_authorization_grant", "made_approve_authorization_operation"]) {
      assert.ok(!names.includes(never), never);
    }

    // Diseñar, validar y explicar: auto, sin fricción.
    const designed = (await h.gw.call(ServerName.MADE, t("made_design_ceremony"), DESIGN, ctx)).structured as { definition_yaml: string; publishable: boolean };
    assert.ok(designed.publishable && designed.definition_yaml.includes("name: s3a_contract"));
    const validated = (await h.gw.call(ServerName.MADE, t("made_validate_ceremony_draft"), { definition_yaml: designed.definition_yaml }, ctx)).structured as { publishable: boolean };
    assert.equal(validated.publishable, true);
    await h.gw.call(ServerName.MADE, t("made_explain_ceremony_draft"), { definition_yaml: designed.definition_yaml }, ctx);
    assert.ok((await h.gw.call(ServerName.MADE, t("made_list_contracts"), {}, ctx)).structured, "list_contracts: alcance global, sólo esa acción");

    // Fuera de fase: la fase interactiva no expone MADE, así que no se concede nada nuevo.
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_diff_ceremony_definitions"), { before: { definition_yaml: designed.definition_yaml }, after: { definition_yaml: designed.definition_yaml } },
      { sessionId: "s1", phase: "interactive" }), (e) => HostCallError.is(e) && /denied the operation/.test(e.message));

    // Publicar: needs_confirmation; con el token, publica.
    const publish = { definition_yaml: designed.definition_yaml };
    let token = "";
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_publish_ceremony_definition"), publish, ctx), (e) => {
      if (!HostCallError.is(e) || e.code !== "needs_confirmation") return false;
      assert.deepEqual({ ...e.confirmation, token: "-" }, { token: "-", action: "publish_ceremony_definition", scopeSummary: "definition s3a_contract v1.0",
        scopeLabel: 'Definition "s3a_contract" v1.0' });
      token = e.confirmation!.token; return true;
    });
    const published = (await h.gw.call(ServerName.MADE, t("made_publish_ceremony_definition"), publish, { ...ctx, confirmation: token })).structured as { outcome: string };
    assert.equal(published.outcome, "published");

    // Otra definición: el usuario rechaza; nada se publica y queda registrado.
    const other = { definition_yaml: designed.definition_yaml.replace("name: s3a_contract", "name: s3a_declined") };
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_publish_ceremony_definition"), other, ctx), (e) => HostCallError.is(e) && (token = e.confirmation?.token ?? "") !== "");
    assert.deepEqual(await h.gw.confirmation(SessionId.of("s1"), token, "declined"), { recorded: true });

    const facts = madeFacts(i.log);
    const issued = facts.filter((f) => f.type === "made.grant_issued").map((f) => [f.payload.action, (f.payload.scope as { kind: string }).kind, f.payload.class]);
    assert.deepEqual(issued, [["design_ceremony", "global", "auto"], ["validate_ceremony_draft", "definition", "auto"], ["explain_ceremony_draft", "definition", "auto"],
      ["list_contracts", "global", "auto"], ["publish_ceremony_definition", "definition", "confirm"]]);
    assert.deepEqual(facts.filter((f) => f.type === "made.confirmation").map((f) => [f.payload.scopeSummary, f.payload.outcome]),
      [["definition s3a_contract v1.0", "accepted"], ["definition s3a_declined v1.0", "declined"]]);
    assert.ok(!JSON.stringify(facts).includes("Review it."), "ningún hecho lleva el YAML ni las instrucciones");
    // El grant de 5 min de la publicación se revocó en cuanto volvió la llamada (consumed): ningún
    // grant confirm queda vivo para otras llamadas, sesiones u otros clientes del mismo store.
    const consumed = facts.filter((f) => f.type === "made.grant_revoked");
    const confirmGrant = facts.find((f) => f.type === "made.grant_issued" && f.payload.class === "confirm")!.payload.grantId;
    assert.deepEqual(consumed.map((f) => [f.stream, f.payload.grantId, f.payload.reason]), [["host", confirmGrant, "consumed"]]);
    const live = await i.policy();
    assert.equal(live.grants.length, 5);
    assert.deepEqual(live.revocations, [confirmGrant]);

    // doctor: el censo de sólo lectura sobre el store real de made-mcp. Con los grants de pi-runtime
    // no hay nadie más; un grant emitido por otro cliente del mismo principal (como haría el plugin
    // de Claude Code, con la misma configuración) se detecta aunque sólo haya una política.
    const census = new SqliteMadePolicyCensus();
    assert.deepEqual(census.census(i.store), { policies: 1, foreignGrants: 0 });
    const now = Date.now();
    await i.direct("made_issue_authorization_grant", { grant_id: "claude-plugin-contract", grantee_id: live.owner.principal_id, actions: ["get_status"], scope: { kind: "global" },
      valid_from: new Date(now).toISOString(), valid_until: new Date(now + 60_000).toISOString(), delegation_depth: 0 });
    assert.deepEqual(census.census(i.store), { policies: 1, foreignGrants: 1 });
    await i.direct("made_revoke_authorization_grant", { grant_id: "claude-plugin-contract", reason: "contract" });

    // Cierre de la sesión: el host revoca los que quedan vivos y lo registra.
    await record(h.gw, "s1", "session.closed", "c");
    await waitFor(() => madeFacts(i.log).filter((f) => f.type === "made.grant_revoked").length === 5);
    assert.deepEqual(madeFacts(i.log).filter((f) => f.type === "made.grant_revoked").map((f) => `${f.stream} ${f.payload.session} ${f.payload.reason}`).sort(),
      ["host s1 consumed", "host s1 session_closed", "host s1 session_closed", "host s1 session_closed", "host s1 session_closed"]);
    assert.deepEqual((await i.policy()).revocations.sort(), [...live.grants.map((g) => g.grant_id), "claude-plugin-contract"].sort());
  } finally { await stop(h); i.cleanup(); }
});

test("made-mcp 0.9.0: al arrancar, el host revoca los grants que dejó vivos otro host de una sesión ya cerrada", { skip, timeout: 120_000 }, async () => {
  const i = install();
  let h = await start(i);
  try {
    const ctx: CallContextDto = { sessionId: "s1", phase: "design" };
    await record(h.gw, "s1", "session.opened", "o");
    await h.gw.call(ServerName.MADE, t("made_list_contracts"), {}, ctx);
    await stop(h);
    // Pi cerró la sesión con el host caído: el cierre llega al log sin pasar por el host.
    const db = SqliteDatabase.open(i.log);
    new RecordFact(new SqliteEventStore(db), new SystemClock()).execute(fact("session.closed", "late", { reason: "quit" }, StreamId.session(SessionId.of("s1")), Date.now()));
    db.close();
    h = await start(i);
    await waitFor(() => madeFacts(i.log).some((f) => f.type === "made.grant_revoked"));
    const revoked = madeFacts(i.log).filter((f) => f.type === "made.grant_revoked");
    assert.deepEqual(revoked.map((f) => f.payload.reason), ["session_closed"]);
    assert.deepEqual((await i.policy()).revocations, [revoked[0].payload.grantId]);
  } finally { await stop(h); i.cleanup(); }
});
