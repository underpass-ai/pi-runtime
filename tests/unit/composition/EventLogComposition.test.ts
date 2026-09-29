import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLogComposition } from "../../../src/composition/EventLogComposition.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { InMemoryEventStore } from "../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { ExportEventLog } from "../../../src/application/use-cases/ExportEventLog.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";
import { ProjectId } from "../../../src/domain/project/ProjectId.ts";
import { StreamVersion } from "../../../src/domain/events/StreamVersion.ts";
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
  assert.equal(out[0], "imported 1 events");
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
