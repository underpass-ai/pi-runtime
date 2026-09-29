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
  assert.deepEqual(started[0].payload.catalogs, {}, "sin fingerprints.json registrados: huellas vacías");
  assert.ok("code" in hostStream(log)[2].payload, "server.exited lleva el código de salida");
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

test("con OTEL_EXPORTER_OTLP_ENDPOINT el host exporta la traza de su arranque al apagarse y escribe host.log en JSON", async () => {
  const { createServer } = await import("node:http");
  const { existsSync, readFileSync } = await import("node:fs");
  const { hostname } = await import("node:os");
  const received: { path: string; body: { resourceSpans?: { scopeSpans: { spans: { name: string; spanId: string; traceId: string; parentSpanId?: string }[] }[] }[]; resourceMetrics?: { scopeMetrics: { metrics: { name: string }[] }[] }[] } }[] = [];
  const collector = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => { received.push({ path: req.url ?? "", body: JSON.parse(data) }); res.writeHead(200).end("{}"); });
  });
  await new Promise<void>((r) => collector.listen(0, "127.0.0.1", () => r()));
  const port = (collector.address() as { port: number }).port;
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", FAKE_SERVER_CMD: `${process.execPath} ${fake}`,
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20t0p-s3cr3t", OTEL_EXPORTER_OTLP_TIMEOUT: "2000" };
  const paths = new StatePaths(env);
  try {
    const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), new DetachedHostLauncher(hostEntry, env, (p) => paths.hostStderrOf(p)));
    const g = await uc.execute(cwd);
    try {
      await g.call(ServerName.KMP, ToolName.of("kmp_echo"), { x: 1 });
      const status = await g.summary(SessionId.of("s1"));
      assert.equal(status.exporter?.state, "ok", "con endpoint válido el exportador está activo");
      assert.equal(status.kpis, null, "una sesión que el log no conoce no tiene KPIs");
    } finally { g.close(); }
    const project = new GitProjectLocator().locate(cwd);
    const pid = hostStream(paths.eventLogOf(project))[0].payload.pid as number;
    await waitFor(() => !alive(pid));

    const spans = received.filter((r) => r.path === "/v1/traces").flatMap((r) => r.body.resourceSpans![0].scopeSpans[0].spans);
    assert.deepEqual(spans.map((s) => s.name).sort(), ["host", "mcp_server"]);
    const host = spans.find((s) => s.name === "host")!; const server = spans.find((s) => s.name === "mcp_server")!;
    assert.equal(server.parentSpanId, host.spanId);
    assert.equal(server.traceId, host.traceId);
    const metrics = received.filter((r) => r.path === "/v1/metrics").flatMap((r) => r.body.resourceMetrics![0].scopeMetrics[0].metrics.map((m) => m.name));
    assert.ok(metrics.includes("pi_runtime_server_starts_total"));
    const wire = JSON.stringify(received);
    for (const secret of [cwd, home, "t0p-s3cr3t", ...(hostname().length > 3 ? [hostname()] : [])]) assert.equal(wire.includes(secret), false, secret);
    assert.ok(existsSync(paths.hostStderrOf(project)), "stdout/stderr del proceso van a host.stderr.log");
    const logText = existsSync(paths.hostLogOf(project)) ? readFileSync(paths.hostLogOf(project), "utf8") : "";
    for (const line of logText.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      assert.ok(typeof entry.ts === "string" && typeof entry.level === "string" && typeof entry.msg === "string", line);
    }
    assert.equal(logText.includes("t0p-s3cr3t"), false);
    assert.deepEqual(hostStream(paths.eventLogOf(project)).map((e) => e.type).at(-1), "host.stopped");
  } finally { collector.closeAllConnections(); collector.close(); }
});

test("con un endpoint OTLP inválido el host no exporta, lo avisa una vez sin repetir el valor y /underpass-status dice disabled", async () => {
  const { readFileSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", FAKE_SERVER_CMD: `${process.execPath} ${fake}`,
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.internal.example:4318", OTEL_EXPORTER_OTLP_HEADERS: "authorization=t0p-s3cr3t" };
  const paths = new StatePaths(env);
  const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), new DetachedHostLauncher(hostEntry, env, (p) => paths.hostStderrOf(p)));
  const g = await uc.execute(cwd);
  try { assert.deepEqual((await g.summary(SessionId.of("s1"))).exporter, { state: "disabled", lag: 0, since: null }); } finally { g.close(); }
  const project = new GitProjectLocator().locate(cwd);
  const pid = hostStream(paths.eventLogOf(project))[0].payload.pid as number;
  await waitFor(() => !alive(pid));
  const lines = readFileSync(paths.hostLogOf(project), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const warned = lines.filter((l) => l.msg === "otlp exporter disabled: invalid configuration");
  assert.equal(warned.length, 1);
  assert.equal(warned[0].level, "warn");
  assert.equal(typeof warned[0].reason, "string");
  const text = JSON.stringify(lines);
  for (const secret of ["collector.internal.example", "t0p-s3cr3t", cwd, home]) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(hostStream(paths.eventLogOf(project)).map((e) => e.type).at(-1), "host.stopped");
});

test("un colector que nunca responde no bloquea al host: /underpass-status dice failing y el apagado termina", async () => {
  const { createServer } = await import("node:net");
  const { readFileSync } = await import("node:fs");
  const sockets: import("node:net").Socket[] = [];
  const blackHole = createServer((s) => { sockets.push(s); s.on("error", () => {}); });
  await new Promise<void>((r) => blackHole.listen(0, "127.0.0.1", () => r()));
  const port = (blackHole.address() as { port: number }).port;
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", FAKE_SERVER_CMD: `${process.execPath} ${fake}`,
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_TIMEOUT: "300" };
  const paths = new StatePaths(env);
  try {
    const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), new DetachedHostLauncher(hostEntry, env, (p) => paths.hostStderrOf(p)));
    const g = await uc.execute(cwd);
    try {
      // Una sesión cerrada deja un span completo: el siguiente tick (5 s) intenta enviarlo.
      const fact = (type: string, about: string) => ({ stream: "session" as const, sessionId: "s1", type, typeVersion: 1, about, occurredAtMs: Date.now(), actor: { kind: "agent", id: "pi:1" }, payload: { reason: "startup" } });
      await g.record(fact("session.opened", "o")); await g.record(fact("session.closed", "c"));
      let state = "";
      const until = Date.now() + 10_000;
      while (state !== "failing" && Date.now() < until) { state = (await g.summary(SessionId.of("s1"))).exporter?.state ?? ""; await new Promise((r) => setTimeout(r, 50)); }
      assert.equal(state, "failing");
    } finally { g.close(); }
    const project = new GitProjectLocator().locate(cwd);
    const pid = hostStream(paths.eventLogOf(project))[0].payload.pid as number;
    await waitFor(() => !alive(pid));
    assert.deepEqual(hostStream(paths.eventLogOf(project)).map((e) => e.type).at(-1), "host.stopped");
    const log = readFileSync(paths.hostLogOf(project), "utf8");
    assert.match(log, /otlp export failing; retrying with backoff/);
    assert.equal(log.includes(String(port)), false, "el aviso no nombra el endpoint");
  } finally { for (const s of sockets) s.destroy(); blackHole.close(); }
});

test("withinDeadline: una exportación final que no termina (o falla) no retiene el apagado", async () => {
  const { HostComposition } = await import("../../../src/composition/HostComposition.ts");
  const started = Date.now();
  assert.equal(await HostComposition.withinDeadline(new Promise<void>(() => {}), 30), false);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await HostComposition.withinDeadline(Promise.reject(new Error("boom")), 1000), true);
  assert.equal(await HostComposition.withinDeadline(Promise.resolve(), 1000), true);
});
