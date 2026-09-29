import { test } from "node:test";
import assert from "node:assert/strict";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";

test("rutas de estado bajo XDG y fuera del proyecto", () => {
  const p = Project.of(ProjectRoot.of("/repo"));
  const s = new StatePaths({ HOME: "/h" });
  assert.equal(s.root(), "/h/.local/state/pi-runtime");
  assert.equal(s.socketOf(p), `/h/.local/state/pi-runtime/projects/${p.id}/host.sock`);
  assert.equal(s.binDir(), "/h/.local/share/pi-runtime/bin");
  assert.equal(s.hostLogOf(p), `/h/.local/state/pi-runtime/projects/${p.id}/host.log`);
  assert.equal(s.hostStderrOf(p), `/h/.local/state/pi-runtime/projects/${p.id}/host.stderr.log`);
  assert.equal(new StatePaths({ HOME: "/h", XDG_STATE_HOME: "/s", XDG_DATA_HOME: "/d" }).fingerprintsFile(), "/s/pi-runtime/fingerprints.json");
  assert.equal(new StatePaths({ HOME: "/h", XDG_STATE_HOME: "/s" }).telemetryKeyFile(), "/s/pi-runtime/telemetry.key");
  assert.equal(new StatePaths({ HOME: "/h", XDG_DATA_HOME: "/d" }).binDir(), "/d/pi-runtime/bin");
});

test("rutas de MADE compatibles con el plugin: store y raíz de configuración", () => {
  const s = new StatePaths({ HOME: "/h" });
  assert.equal(s.madeStore().value, "/h/.local/state/underpass-made/ceremonies.sqlite3");
  assert.equal(s.madeConfigRoot(), "/h/.config/underpass-made/embedded");
  const x = new StatePaths({ HOME: "/h", XDG_STATE_HOME: "/s", XDG_CONFIG_HOME: "/c" });
  assert.equal(x.madeStore().value, "/s/underpass-made/ceremonies.sqlite3");
  assert.equal(x.madeConfigRoot(), "/c/underpass-made/embedded");
  const o = new StatePaths({ HOME: "/h", MADE_MCP_STORE_PATH: "/m/store.sqlite3", MADE_SETUP_CONFIG_ROOT: "/r" });
  assert.equal(o.madeStore().value, "/m/store.sqlite3");
  assert.equal(o.madeConfigRoot(), "/r");
});

test("semántica ${VAR:-default}: una variable vacía cuenta como no definida", () => {
  const s = new StatePaths({ HOME: "/h", XDG_STATE_HOME: "", XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", MADE_MCP_STORE_PATH: "", MADE_SETUP_CONFIG_ROOT: "" });
  assert.equal(s.root(), "/h/.local/state/pi-runtime");
  assert.equal(s.binDir(), "/h/.local/share/pi-runtime/bin");
  assert.equal(s.madeStore().value, "/h/.local/state/underpass-made/ceremonies.sqlite3");
  assert.equal(s.madeConfigRoot(), "/h/.config/underpass-made/embedded");
});

test("una ruta resultante relativa es un error, nunca un directorio dentro del repo", () => {
  assert.throws(() => new StatePaths({}).root(), /HOME.*absolute/);
  assert.throws(() => new StatePaths({ HOME: "" }).madeConfigRoot(), /absolute/);
  assert.throws(() => new StatePaths({ HOME: "/h", XDG_STATE_HOME: "rel" }).root(), /XDG_STATE_HOME/);
  assert.throws(() => new StatePaths({ HOME: "/h", XDG_DATA_HOME: "rel" }).binDir(), /XDG_DATA_HOME/);
  assert.throws(() => new StatePaths({ HOME: "/h", XDG_CONFIG_HOME: "rel" }).madeConfigRoot(), /XDG_CONFIG_HOME/);
  assert.throws(() => new StatePaths({ HOME: "/h", MADE_SETUP_CONFIG_ROOT: "rel" }).madeConfigRoot(), /MADE_SETUP_CONFIG_ROOT/);
  assert.throws(() => new StatePaths({ HOME: "/h", MADE_MCP_STORE_PATH: "rel.sqlite3" }).madeStore(), /MADE_MCP_STORE_PATH/);
});

test("log de eventos y spool dentro del directorio del proyecto", () => {
  const p = Project.of(ProjectRoot.of("/repo"));
  const s = new StatePaths({ HOME: "/h", XDG_STATE_HOME: "/s" });
  assert.equal(s.eventLogOf(p), `/s/pi-runtime/projects/${p.id}/events.sqlite3`);
  assert.equal(s.spoolDirOf(p), `/s/pi-runtime/projects/${p.id}/spool`);
  assert.throws(() => new StatePaths({}).eventLogOf(p), /absolute/);
});
