import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliComposition, loadMadeConfigurationOrThrow } from "../../../src/composition/CliComposition.ts";
import { FsMadeConfigurationRepository } from "../../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { MadeConfiguration } from "../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../src/domain/made/StorePath.ts";

test("compone el CLI real y ejecuta un verbo desconocido sin tocar red", async () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const out: string[] = [];
  const cli = CliComposition.build({ ...process.env, HOME: home, XDG_STATE_HOME: join(home, ".local/state"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CONFIG_HOME: join(home, ".config") }, (s) => out.push(s));
  assert.equal(await cli.run(["nope"]), 2);
  assert.match(out.join("\n"), /usage: underpass setup \| doctor \| update/);
});

test("la conexión de doctor a MADE sólo lee la configuración privada; sin fichero no crea nada", () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const configs = new FsMadeConfigurationRepository({ HOME: home });
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  assert.throws(() => loadMadeConfigurationOrThrow(configs, store), /MADE private configuration missing; run `underpass setup`/);
  assert.equal(existsSync(configs.locationOf(store)), false);
});

test("la conexión de doctor a MADE reutiliza la configuración existente sin tocarla", () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const configs = new FsMadeConfigurationRepository({ HOME: home });
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(6));
  configs.create(store, cfg);
  assert.deepEqual(loadMadeConfigurationOrThrow(configs, store).entries(), cfg.entries());
});
