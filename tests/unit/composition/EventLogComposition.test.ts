import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLogComposition } from "../../../src/composition/EventLogComposition.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { InMemoryEventStore } from "../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { SqliteDatabase } from "../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteProjectionStore } from "../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { SqliteTelemetryEpochStore } from "../../../src/adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import { ExportEventLog } from "../../../src/application/use-cases/ExportEventLog.ts";
import { TraceExport } from "../../../src/application/use-cases/TraceExport.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";
import { ProjectId } from "../../../src/domain/project/ProjectId.ts";
import { StreamVersion } from "../../../src/domain/events/StreamVersion.ts";
import { OtlpConfiguration } from "../../../src/domain/telemetry/OtlpConfiguration.ts";
import { AT, SESSION, fact } from "../../support/recordFixtures.ts";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "underpass-evlog-"));
  const state = join(home, "state");
  const paths = new StatePaths({ HOME: home, XDG_STATE_HOME: state });
  const project = Project.of(ProjectRoot.of(home));
  const out: string[] = [];
  const composition = new EventLogComposition(paths, project, (s) => out.push(s));
  return { home, state, out, composition, log: paths.eventLogOf(project), spool: paths.spoolDirOf(project) };
}

function bundle(dir: string): string {
  const src = new InMemoryEventStore();
  src.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
  const path = join(dir, "b.jsonl");
  writeFileSync(path, new ExportEventLog(src, ProjectId.of("0123456789abcdef")).execute().join("\n"));
  return path;
}

test("doctor sin log: WARN 'no events recorded yet' y no crea nada en el estado", () => {
  const { state, composition } = setup();
  const checks = composition.diagnosis().execute();
  const log = checks.find((c) => c.name.value === "event log")!;
  assert.deepEqual([log.section.value, log.status.value, log.detail.value], ["events", "WARN", "no events recorded yet"]);
  assert.ok(checks.filter((c) => c.name.value !== "event log").every((c) => c.status.value === "OK"));
  assert.equal(existsSync(state), false);
});

test("doctor con log existente lo abre en sólo lectura (sin tocar el fichero) y ve el spool real", () => {
  const { home, out, composition, log, spool } = setup();
  assert.equal(composition.cli().run(["import", bundle(home)]), 0);
  assert.match(out[0], /^warning: bundle project_id 0123456789abcdef differs from this project/, "el bundle de prueba es de otro proyecto");
  assert.equal(out[1], "imported 1 events");
  const before = statSync(log).mtimeMs;
  mkdirSync(spool, { recursive: true }); writeFileSync(join(spool, "9.gap"), "");
  const checks = composition.diagnosis().execute();
  assert.equal(checks.find((c) => c.name.value === "event log")!.detail.value, "1 events, 1 streams");
  assert.equal(checks.find((c) => c.name.value === "projections")!.status.value, "WARN");
  assert.equal(checks.find((c) => c.name.value === "fact spool")!.status.value, "FAIL");
  assert.equal(statSync(log).mtimeMs, before);
});

test("un bundle inválido o ilegible se rechaza sin crear el log ni el estado", () => {
  const { home, state, out, composition } = setup();
  const bad = join(home, "bad.jsonl");
  writeFileSync(bad, '{"format":"pi-runtime.events.v1","count":1,"sha256":"x"}\n{"not":"a record"}');
  assert.equal(composition.cli().run(["import", bad]), 1);
  assert.equal(composition.cli().run(["import", join(home, "missing.jsonl")]), 1);
  assert.equal(out.length, 2);
  assert.ok(out.every((l) => l.startsWith("error: ")));
  assert.equal(existsSync(state), false);
});

test("sin log, lectura y rebuild no crean nada; tras import, los verbos de lectura leen el log", () => {
  const { home, state, out, composition } = setup();
  for (const args of [["sessions"], ["tools"], ["verify"], ["export"], ["show", "s1"], ["rebuild", "session_summary"]]) assert.equal(composition.cli().run(args), 0, args.join(" "));
  assert.equal(existsSync(state), false);
  out.length = 0;
  assert.equal(composition.cli().run(["import", bundle(home)]), 0);
  assert.equal(composition.cli().run(["verify"]), 0);
  assert.equal(composition.cli().run(["rebuild", "session_summary"]), 0);
  assert.equal(composition.cli().run(["sessions"]), 0);
  assert.equal(out[out.length - 1].split("  ")[0], "s1");
  assert.equal(readdirSync(join(state, "pi-runtime", "projects")).length, 1);
});

test("ack-gaps borra los marcadores del spool del proyecto (sin crear el log) y doctor vuelve a OK", () => {
  const { state, out, composition, spool, log } = setup();
  mkdirSync(spool, { recursive: true }); writeFileSync(join(spool, "9.gap"), ""); writeFileSync(join(spool, "9.jsonl"), "{}\n");
  assert.equal(composition.diagnosis().execute().find((c) => c.name.value === "fact spool")!.status.value, "FAIL");
  assert.equal(composition.cli().run(["ack-gaps"]), 0);
  assert.deepEqual(out, ["acknowledged 9.gap", "acknowledged 1 spool gap marker(s)"]);
  assert.deepEqual(readdirSync(spool), ["9.jsonl"]);
  assert.equal(existsSync(log), false);
  assert.equal(composition.diagnosis().execute().find((c) => c.name.value === "fact spool")!.status.value, "WARN");
  assert.ok(existsSync(state));
});

test("rebuild telemetry_metrics fija un inicio del acumulado en meta, rebuild otlp_traces pone su cursor a 0 y metrics lee el log", () => {
  const { home, out, composition, log } = setup();
  assert.equal(composition.cli().run(["import", bundle(home)]), 0);
  assert.equal(composition.cli().run(["rebuild", "telemetry_metrics"]), 0);
  assert.equal(composition.cli().run(["rebuild", "otlp_traces"]), 0);
  assert.deepEqual(out.slice(-2), ["rebuilt telemetry_metrics", "rebuilt otlp_traces"]);
  out.length = 0;
  assert.equal(composition.metrics().run([]), 0);
  assert.match(out.join("\n"), /^pi_runtime_sessions_total\{event="opened"\} 1$/m);
  const db = SqliteDatabase.open(log);
  try {
    assert.notEqual(new SqliteTelemetryEpochStore(db).read(), null);
    assert.equal(new SqliteProjectionStore(db).cursor(TraceExport.NAME)?.position.value, 0);
  } finally { db.close(); }
});

test("doctor añade la sección telemetry; un endpoint inválido es FAIL sin repetirlo", () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-evlog-"));
  const paths = new StatePaths({ HOME: home, XDG_STATE_HOME: join(home, "state") });
  const composition = new EventLogComposition(paths, Project.of(ProjectRoot.of(home)), () => {}, OtlpConfiguration.fromEnvironment({ endpoint: "http://collector.internal:4318" }));
  const checks = composition.diagnosis().execute().filter((c) => c.section.value === "telemetry");
  assert.deepEqual(checks.map((c) => [c.name.value, c.status.value]), [["telemetry projections", "OK"], ["otlp exporter", "FAIL"]]);
  assert.equal(checks[1].detail.value.includes("collector.internal"), false);
  assert.deepEqual(setup().composition.diagnosis().execute().filter((c) => c.section.value === "telemetry").map((c) => c.detail.value), ["no events yet", "disabled"]);
});

test("learning: report sin log no crea nada; mode crea el log y registra el hecho; report lo lee", () => {
  const { state, out, composition, log } = setup();
  assert.equal(composition.learning().run(["report"]), 0);
  assert.deepEqual(out, ["mode shadow (k=12)", "no learning decisions recorded yet"]);
  assert.equal(existsSync(state), false);
  assert.equal(composition.learning().run(["mode", "active", "--k", "6"]), 0);
  assert.equal(out.at(-1), "learning mode shadow -> active (k=6)");
  assert.ok(existsSync(log));
  assert.equal(composition.cli().run(["rebuild", "tool_bandit"]), 0);
  assert.equal(composition.cli().run(["rebuild", "learning_eval"]), 0);
  out.length = 0;
  assert.equal(composition.learning().run(["report"]), 0);
  assert.equal(out[0], "mode active (k=6)");
  assert.equal(composition.learning().run(["mode", "fallback"]), 2);
});
