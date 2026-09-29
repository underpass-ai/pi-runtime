import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MADE_BIN } from "./support.ts";
import { StdioMcpConnector } from "../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { MadeServerCommandFactory } from "../../src/adapters/outbound/process/MadeServerCommandFactory.ts";
import { Project } from "../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../src/domain/project/ProjectRoot.ts";
import { ToolSuccess } from "../../src/domain/mcp/ToolSuccess.ts";
import { SqliteMadePolicyCensus } from "../../src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts";
import { NodeEntropySource } from "../../src/adapters/outbound/crypto/NodeEntropySource.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { GitProjectLocator } from "../../src/adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { SqliteDatabase } from "../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SystemClock } from "../../src/adapters/outbound/clock/SystemClock.ts";
import type { CallContextDto } from "../../src/application/dto/CallContextDto.ts";
import { HostCallError } from "../../src/application/ports/HostCallError.ts";
import { EnsureMadeConfiguration } from "../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { RecordFact } from "../../src/application/use-cases/RecordFact.ts";
import { StatePaths } from "../../src/composition/StatePaths.ts";
import { SessionId } from "../../src/domain/events/SessionId.ts";
import { StreamId } from "../../src/domain/events/StreamId.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../src/domain/mcp/ToolName.ts";
import { fact } from "../support/recordFixtures.ts";

const skip = !MADE_BIN && "UNDERPASS_MADE_MCP_BIN not set";
const hostEntry = new URL("../fixtures/made-host.ts", import.meta.url).pathname;
const t = (n: string) => ToolName.of(n);
const DESIGN = { name: "s3a_contract", objective: "Review a change.", required_inputs: ["brief"], outputs: ["verdict"], participants: [{ role_id: "REVIEWER" }],
  stages: [{ id: "review", owner_role_id: "REVIEWER", instructions: "Review it." }] };
const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const until = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > until) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 100)); }
};

// Instalación aislada: HOME, XDG y proyecto temporales; configuración privada y política de
// MADE sembradas como `underpass setup`. Nunca toca el store ni la configuración reales.
function install() {
  const home = mkdtempSync(join(tmpdir(), "s3a-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "s3a-proj-")));
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"), UNDERPASS_HOST_IDLE_MS: "600000", UNDERPASS_MADE_MCP_BIN: MADE_BIN };
  delete env.MADE_SETUP_CONFIG_ROOT; delete env.MADE_MCP_STORE_PATH; delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const paths = new StatePaths(env);
  const store = paths.madeStore();
  mkdirSync(dirname(store.value), { recursive: true, mode: 0o700 });
  const { configuration } = new EnsureMadeConfiguration(new FsMadeConfigurationRepository(paths.madeConfigRoot()), new NodeEntropySource()).execute(store);
  execFileSync(MADE_BIN!, ["bootstrap-authorization", store.value, "--policy-id", configuration.policy.value, "--trusted-host-id", configuration.trustedHost.value], { env });
  const project = new GitProjectLocator().locate(cwd);
  // La política se lee directamente como dueño, con otro made-mcp sobre el mismo store: por el
  // host, las tools never ya no llegan a MADE.
  const direct = async <T>(tool: string, args: Record<string, unknown>): Promise<T> => {
    const conn = await new StdioMcpConnector(60_000).open(ServerName.MADE, new MadeServerCommandFactory(MADE_BIN!, store, configuration, env).commandFor(Project.of(ProjectRoot.of(cwd))));
    try {
      const out = await conn.call(t(tool), args);
      assert.ok(out instanceof ToolSuccess, `el dueño llama a ${tool}`);
      return out.structured as T;
    } finally { await conn.close(); }
  };
  const policy = async () => (await direct<{ policy: { owner: { principal_id: string }; grants: { grant_id: string; actions: string[] }[]; revocations: string[] } }>("made_get_authorization_policy", {})).policy;
  return { home, cwd, env, store, policy, direct, socket: paths.socketOf(project), log: paths.eventLogOf(project), cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); } };
}

async function start(i: ReturnType<typeof install>): Promise<{ child: ChildProcess; gw: UnixSocketHostGateway }> {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", hostEntry, i.cwd], { env: i.env, stdio: ["ignore", "ignore", "inherit"] });
  return { child, gw: await UnixSocketHostGateway.connect(i.socket, 100, 100) };
}
async function stop(h: { child: ChildProcess; gw: UnixSocketHostGateway }): Promise<void> {
  h.gw.close();
  const exited = new Promise((r) => h.child.once("exit", r));
  h.child.kill("SIGTERM");
  await exited;
}
const record = (gw: UnixSocketHostGateway, sid: string, type: string, about: string) =>
  gw.record({ stream: "session", sessionId: sid, type, typeVersion: 1, about, occurredAtMs: Date.now(), actor: { kind: "agent", id: "pi:contract" }, payload: { reason: type === "session.closed" ? "quit" : "startup" } });
const madeFacts = (log: string) => {
  const db = SqliteDatabase.openReadOnly(log);
  try {
    const events = new SqliteEventStore(db);
    return events.streams().flatMap((s) => events.readStream(s)).filter((r) => r.type.value.startsWith("made.")).map((r) => ({ type: r.type.value, stream: r.stream.value, payload: r.payload.toValue() as Record<string, unknown> }));
  } finally { db.close(); }
};

test("made-mcp 0.8.0 por el host real: lecturas automáticas, publicar con confirmación, rechazo, revocación al cerrar", { skip, timeout: 120_000 }, async () => {
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

test("made-mcp 0.8.0: al arrancar, el host revoca los grants que dejó vivos otro host de una sesión ya cerrada", { skip, timeout: 120_000 }, async () => {
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
