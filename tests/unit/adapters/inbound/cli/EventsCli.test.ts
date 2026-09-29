import { test } from "node:test";
import assert from "node:assert/strict";
import { EventsCli } from "../../../../../src/adapters/inbound/cli/EventsCli.ts";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SessionSummaryProjection } from "../../../../../src/application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../../../../../src/application/projections/ToolStatsProjection.ts";
import type { EventStore } from "../../../../../src/application/ports/EventStore.ts";
import { ProjectionRunner } from "../../../../../src/application/services/ProjectionRunner.ts";
import { ExportEventLog } from "../../../../../src/application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../../../../../src/application/use-cases/ImportEventLog.ts";
import { ListSessions } from "../../../../../src/application/use-cases/ListSessions.ts";
import { RebuildProjection } from "../../../../../src/application/use-cases/RebuildProjection.ts";
import { ShowSession } from "../../../../../src/application/use-cases/ShowSession.ts";
import { ToolStatsReport } from "../../../../../src/application/use-cases/ToolStatsReport.ts";
import { VerifyEventLog } from "../../../../../src/application/use-cases/VerifyEventLog.ts";
import { ProjectId } from "../../../../../src/domain/project/ProjectId.ts";
import { EventRecord } from "../../../../../src/domain/events/EventRecord.ts";
import type { StreamId } from "../../../../../src/domain/events/StreamId.ts";
import { CanonicalJson } from "../../../../../src/domain/shared/CanonicalJson.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

const PROJECT = ProjectId.of("0123456789abcdef");

function cli(events: EventStore = new InMemoryEventStore(), files: Record<string, string> = {}, verifyFrom: EventStore = events) {
  const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection(), new ToolStatsProjection()]);
  runner.runOnce();
  const out: string[] = [];
  const c = new EventsCli({
    sessions: new ListSessions(store), show: new ShowSession(events), tools: new ToolStatsReport(store), verify: new VerifyEventLog(verifyFrom),
    exportLog: new ExportEventLog(events, PROJECT), importLog: new ImportEventLog(events), rebuild: new RebuildProjection(runner),
    readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; }, print: (s) => out.push(s),
  });
  return { c, out, text: () => out.join("\n"), events };
}

function seeded(): InMemoryEventStore {
  const s = new InMemoryEventStore();
  s.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", {}, SESSION, 1_000),
    fact("turn.completed", "t1", { model: "m", tokens: { input: 10, output: 5 }, cost: 0.5 }, SESSION, 2_000),
    fact("tool.completed", "c1", { server: "kmp", tool: "kmp_ask", status: "succeeded", durationMs: 12 }, SESSION, 3_000),
  ], AT);
  return s;
}

test("sessions, show y tools imprimen una línea por elemento", () => {
  const { c, out, text } = cli(seeded());
  assert.equal(c.run(["sessions"]), 0);
  assert.match(text(), /^s1  \S+  \S+  turns=1  tokens=10\+5  cost=0\.5000  failures=0$/m);
  out.length = 0;
  assert.equal(c.run(["show", "s1"]), 0);
  assert.equal(out.length, 3);
  assert.match(out[0], /^v1  \S+  session\.opened  \{\}$/);
  assert.match(out[1], /^v2  .*turn\.completed  \{"cost":0\.5/);
  out.length = 0;
  assert.equal(c.run(["tools"]), 0);
  assert.deepEqual(out, ["kmp/kmp_ask  n=1  ok=1  fail=0  refused=0  aborted=0  p50=12  p95=12"]);
});

test("sin eventos, sessions y tools lo dicen y salen con 0", () => {
  const { c, text } = cli();
  assert.equal(c.run(["sessions"]), 0);
  assert.equal(c.run(["tools"]), 0);
  assert.equal(c.run(["verify"]), 0);
  assert.match(text(), /no sessions recorded yet/);
  assert.match(text(), /no tool calls recorded yet/);
  assert.match(text(), /no streams recorded yet/);
});

test("verify: intact sale 0, --stream acota; un stream roto sale 1", () => {
  const { c, out } = cli(seeded());
  assert.equal(c.run(["verify"]), 0);
  assert.deepEqual(out, ["session:s1  intact"]);
  out.length = 0;
  assert.equal(c.run(["verify", "--stream", "host"]), 0);
  assert.deepEqual(out, ["host  notFound"]);
  const src = seeded();
  const tampered = Object.assign(Object.create(null) as EventStore, {
    streams: () => src.streams(),
    readStream: (st: StreamId) => src.readStream(st).map((r, i) => (i === 1 ? EventRecord.restore({ ...r, payload: CanonicalJson.of({ x: 1 }) }) : r)),
  });
  const b = cli(src, {}, tampered);
  const bad = b.c;
  assert.equal(bad.run(["verify"]), 1);
  assert.match(b.text(), /session:s1  broken at v2: /);
});

test("export → import en otro almacén imprime 'imported 3 events'; --since acota", () => {
  const { c, out } = cli(seeded());
  assert.equal(c.run(["export"]), 0);
  assert.equal(JSON.parse(out[0]).count, 3);
  const bundle = out.join("\n");
  const dst = cli(new InMemoryEventStore(), { "/b.jsonl": bundle });
  assert.equal(dst.c.run(["import", "/b.jsonl"]), 0);
  assert.deepEqual(dst.out, ["imported 3 events"]);
  assert.equal(dst.events.lastPosition().value, 3);
  out.length = 0;
  assert.equal(c.run(["export", "--since", "2"]), 0);
  assert.equal(JSON.parse(out[0]).count, 1);
});

test("rebuild reconstruye la proyección; errores salen con 1 y un mensaje limpio", () => {
  const { c, out, text } = cli(seeded());
  assert.equal(c.run(["rebuild", "session_summary"]), 0);
  assert.deepEqual(out, ["rebuilt session_summary"]);
  assert.equal(c.run(["rebuild", "nope"]), 1);
  assert.equal(c.run(["import", "/missing.jsonl"]), 1);
  assert.match(text(), /^error: .*ENOENT: \/missing\.jsonl/m);
});

test("uso incorrecto sale con 2 y muestra el uso", () => {
  const { c, out } = cli(seeded());
  const usage = "usage: underpass events sessions|show <session>|tools|verify [--stream s]|export [--since n]|import <file>|rebuild <projection>";
  for (const args of [["nope"], [], ["show"], ["import"], ["rebuild"], ["export", "--since", "x"]]) {
    out.length = 0;
    assert.equal(c.run(args), 2, JSON.stringify(args));
    assert.deepEqual(out, [usage]);
  }
});
