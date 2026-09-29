import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliComposition } from "../../../src/composition/CliComposition.ts";
import { InMemoryEventStore } from "../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { ExportEventLog } from "../../../src/application/use-cases/ExportEventLog.ts";
import { ProjectId } from "../../../src/domain/project/ProjectId.ts";
import { StreamVersion } from "../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../support/recordFixtures.ts";

test("compone el CLI real y ejecuta un verbo desconocido sin tocar red", async () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const out: string[] = [];
  const cli = CliComposition.build({ ...process.env, HOME: home, XDG_STATE_HOME: join(home, ".local/state"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CONFIG_HOME: join(home, ".config") }, (s) => out.push(s));
  assert.equal(await cli.run(["nope"]), 2);
  assert.match(out.join("\n"), /usage: underpass setup \| doctor \| update \| events/);
});

test("un entorno que resuelve rutas relativas se rechaza al componer", () => {
  assert.throws(() => CliComposition.build({ PATH: process.env.PATH, HOME: "" }, () => {}), /absolute/);
});

test("events: sin log los verbos de lectura no crean nada; sólo import crea el log", async () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const state = join(home, ".local/state");
  const out: string[] = [];
  const cli = () => CliComposition.build({ ...process.env, HOME: home, XDG_STATE_HOME: state, XDG_DATA_HOME: join(home, ".local/share"), XDG_CONFIG_HOME: join(home, ".config") }, (s) => out.push(s));
  assert.equal(await cli().run(["events", "sessions"]), 0);
  assert.equal(await cli().run(["events", "verify"]), 0);
  assert.equal(await cli().run(["events", "import", join(home, "missing.jsonl")]), 1);
  assert.match(out.join("\n"), /no sessions recorded yet/);
  assert.match(out.join("\n"), /^error: ENOENT/m);
  assert.equal(existsSync(state), false, "ni sessions, ni verify, ni un import fallido crean el directorio de estado");

  const src = new InMemoryEventStore();
  src.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
  const bundle = join(home, "b.jsonl");
  writeFileSync(bundle, new ExportEventLog(src, ProjectId.of("0123456789abcdef")).execute().join("\n"));
  out.length = 0;
  assert.equal(await cli().run(["events", "import", bundle]), 0);
  assert.equal(await cli().run(["events", "verify"]), 0);
  assert.deepEqual(out.filter((l) => !l.startsWith("projections behind")), ["imported 1 events", "session:s1  intact"]);
  const projects = readdirSync(join(state, "pi-runtime", "projects"));
  assert.equal(projects.length, 1);
  assert.ok(existsSync(join(state, "pi-runtime", "projects", projects[0], "events.sqlite3")));
});
