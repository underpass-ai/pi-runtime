import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostComposition } from "../../../src/composition/HostComposition.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { JsonPinSetSource } from "../../../src/adapters/outbound/fs/JsonPinSetSource.ts";
import { FsMadeConfigurationRepository } from "../../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { BinaryName } from "../../../src/domain/distribution/BinaryName.ts";
import { MadeConfiguration } from "../../../src/domain/made/MadeConfiguration.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";

const pins = new JsonPinSetSource(new URL("../../../pins.json", import.meta.url).pathname).load();
const project = Project.of(ProjectRoot.of("/repo"));

test("el cableado de producción del host: kmp y made con binarios fijados bajo XDG_DATA_HOME y rutas de MADE resueltas", () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const env = { HOME: home, XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: "", XDG_CONFIG_HOME: join(home, "cfg") };
  const paths = new StatePaths(env);
  const commands = HostComposition.commands(env, paths);
  assert.deepEqual([...commands.keys()], ["kmp", "made"]);

  const kmp = commands.get("kmp")!.commandFor(project);
  assert.equal(kmp.command, join(home, "data/pi-runtime/bin", pins.pinFor(BinaryName.KMP).installedFileName()));
  assert.equal(kmp.cwd, "/repo");

  const made = commands.get("made")!;
  assert.throws(() => made.commandFor(project), /MADE private configuration missing/);
  const store = paths.madeStore();
  assert.equal(store.value, join(home, ".local/state/underpass-made/ceremonies.sqlite3"), "XDG_STATE_HOME vacío cae al valor por defecto");
  new FsMadeConfigurationRepository(paths.madeConfigRoot()).create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(9)));
  const cmd = made.commandFor(project);
  assert.equal(cmd.command, join(home, "data/pi-runtime/bin", pins.pinFor(BinaryName.MADE).installedFileName()));
  assert.equal(cmd.env.MADE_MCP_STORE_PATH, store.value);
  assert.equal(cmd.env.MADE_MCP_BACKEND, "embedded");
});
