import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliComposition } from "../../../src/composition/CliComposition.ts";

test("compone el CLI real y ejecuta un verbo desconocido sin tocar red", async () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const out: string[] = [];
  const cli = CliComposition.build({ ...process.env, HOME: home, XDG_STATE_HOME: join(home, ".local/state"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CONFIG_HOME: join(home, ".config") }, (s) => out.push(s));
  assert.equal(await cli.run(["nope"]), 2);
  assert.match(out.join("\n"), /usage: underpass setup \| doctor \| update/);
});

test("un entorno que resuelve rutas relativas se rechaza al componer", () => {
  assert.throws(() => CliComposition.build({ PATH: process.env.PATH, HOME: "" }, () => {}), /absolute/);
});
