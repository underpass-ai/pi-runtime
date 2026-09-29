// Host real de pi-runtime con made-mcp 0.8.0 sobre una instalación aislada (HOME, XDG y proyecto
// temporales), compartido por los contratos de S3a y F3.
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
import { NodeEntropySource } from "../../src/adapters/outbound/crypto/NodeEntropySource.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { GitProjectLocator } from "../../src/adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { SqliteDatabase } from "../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { EnsureMadeConfiguration } from "../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { StatePaths } from "../../src/composition/StatePaths.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../src/domain/mcp/ToolName.ts";

export const skip = !MADE_BIN && "UNDERPASS_MADE_MCP_BIN not set";
const hostEntry = new URL("../fixtures/made-host.ts", import.meta.url).pathname;
export const t = (n: string) => ToolName.of(n);
export const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const until = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > until) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 100)); }
};

// Instalación aislada: HOME, XDG y proyecto temporales; configuración privada y política de
// MADE sembradas como `underpass setup`. Nunca toca el store ni la configuración reales.
export function install() {
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

export async function start(i: ReturnType<typeof install>): Promise<{ child: ChildProcess; gw: UnixSocketHostGateway }> {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", hostEntry, i.cwd], { env: i.env, stdio: ["ignore", "ignore", "inherit"] });
  return { child, gw: await UnixSocketHostGateway.connect(i.socket, 100, 100) };
}
export async function stop(h: { child: ChildProcess; gw: UnixSocketHostGateway }): Promise<void> {
  h.gw.close();
  const exited = new Promise((r) => h.child.once("exit", r));
  h.child.kill("SIGTERM");
  await exited;
}
export const record = (gw: UnixSocketHostGateway, sid: string, type: string, about: string) =>
  gw.record({ stream: "session", sessionId: sid, type, typeVersion: 1, about, occurredAtMs: Date.now(), actor: { kind: "agent", id: "pi:contract" }, payload: { reason: type === "session.closed" ? "quit" : "startup" } });
export const madeFacts = (log: string) => {
  const db = SqliteDatabase.openReadOnly(log);
  try {
    const events = new SqliteEventStore(db);
    return events.streams().flatMap((s) => events.readStream(s)).filter((r) => r.type.value.startsWith("made.")).map((r) => ({ type: r.type.value, stream: r.stream.value, payload: r.payload.toValue() as Record<string, unknown> }));
  } finally { db.close(); }
};

