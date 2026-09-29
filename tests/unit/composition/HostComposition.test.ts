import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectToProjectHost } from "../../../src/application/use-cases/ConnectToProjectHost.ts";
import { GitProjectLocator } from "../../../src/adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { DetachedHostLauncher } from "../../../src/adapters/outbound/process/DetachedHostLauncher.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { ServerName } from "../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../src/domain/mcp/ToolName.ts";
import { SqliteDatabase } from "../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { StreamId } from "../../../src/domain/events/StreamId.ts";
import { SessionId } from "../../../src/domain/events/SessionId.ts";

const hostEntry = new URL("../../fixtures/test-host.ts", import.meta.url).pathname;
const fake = new URL("../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;

const hostStream = (file: string) => {
  const db = SqliteDatabase.open(file);
  try { return new SqliteEventStore(db).readStream(StreamId.HOST).map((r) => ({ type: r.type.value, payload: r.payload.toValue() as Record<string, unknown> })); }
  finally { db.close(); }
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond: () => boolean, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!cond()) { if (Date.now() > until) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 50)); }
};

test("dos conexiones desde el mismo proyecto comparten un único host", async () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", FAKE_SERVER_CMD: `${process.execPath} ${fake}` };
  const paths = new StatePaths(env);
  let launches = 0;
  const inner = new DetachedHostLauncher(hostEntry, env, (p) => paths.hostLogOf(p));
  const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), { launch: (p) => { launches++; inner.launch(p); } });
  const a = await uc.execute(cwd);
  const b = await uc.execute(cwd);
  try {
    assert.equal(launches, 1);
    assert.deepEqual(await a.call(ServerName.KMP, ToolName.of("kmp_echo"), { x: 1 }), { structured: { x: 1 }, text: "{\"x\":1}" });
    assert.deepEqual(await b.health(), { project: cwd, started: ["kmp"] });
  } finally { a.close(); b.close(); }

  const project = new GitProjectLocator().locate(cwd);
  const log = paths.eventLogOf(project);
  const started = hostStream(log);
  assert.deepEqual(started.map((e) => e.type).slice(0, 2), ["host.started", "server.started"]);
  assert.deepEqual(started[1].payload, { server: "kmp", name: "fake-kmp", version: "0.0.1" });
  const pid = started[0].payload.pid as number;
  assert.equal(typeof pid, "number");

  // Clientes cerrados: el host se apaga por inactividad y deja constancia.
  await waitFor(() => !alive(pid));
  assert.deepEqual(hostStream(log).map((e) => e.type), ["host.started", "server.started", "server.exited", "host.stopped"]);
  assert.deepEqual(hostStream(log)[3].payload, { reason: "idle" });
});

test("el host adopta al arrancar el spool de un proceso de Pi muerto y lo borra tras registrarlo", async () => {
  const { spawnSync } = await import("node:child_process");
  const { existsSync, mkdirSync, readdirSync, writeFileSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", FAKE_SERVER_CMD: `${process.execPath} ${fake}` };
  const paths = new StatePaths(env);
  const project = new GitProjectLocator().locate(cwd);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
  const spoolDir = paths.spoolDirOf(project); mkdirSync(spoolDir, { recursive: true, mode: 0o700 }); // como FsFactSpool
  const line = (type: string, about: string) => `${JSON.stringify({ stream: "session", sessionId: "orphan", type, typeVersion: 1, about, occurredAtMs: 1000, actor: { kind: "agent", id: `pi:${dead}` }, payload: {} })}\n`;
  writeFileSync(join(spoolDir, `${dead}.jsonl`), line("session.opened", "o") + line("turn.completed", "t1") + line("session.closed", "c"), { mode: 0o600 });

  const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), new DetachedHostLauncher(hostEntry, env, (p) => paths.hostLogOf(p)));
  const g = await uc.execute(cwd);
  try { await waitFor(() => readdirSync(spoolDir).length === 0); } finally { g.close(); }
  const log = paths.eventLogOf(project);
  const pid = hostStream(log)[0].payload.pid as number;
  await waitFor(() => !alive(pid));
  const db = SqliteDatabase.open(log);
  try { assert.deepEqual(new SqliteEventStore(db).readStream(StreamId.session(SessionId.of("orphan"))).map((r) => r.type.value), ["session.opened", "turn.completed", "session.closed"]); }
  finally { db.close(); }
  assert.equal(existsSync(join(spoolDir, `${dead}.jsonl`)), false);
});
