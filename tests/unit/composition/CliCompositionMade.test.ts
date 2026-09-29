import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliComposition } from "../../../src/composition/CliComposition.ts";

test("underpass made grants por el CLI real: sin log lo dice y no crea el estado", async () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const out: string[] = [];
  const cli = CliComposition.build({ ...process.env, HOME: home, XDG_STATE_HOME: join(home, ".local/state"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CONFIG_HOME: join(home, ".config") }, (s) => out.push(s));
  assert.equal(await cli.run(["made", "grants"]), 0);
  assert.equal(await cli.run(["made"]), 2);
  assert.deepEqual(out, ["no MADE grants issued by the host", "usage: underpass made grants | ceremonies | revoke-orphans"]);
  assert.equal(existsSync(join(home, ".local/state")), false);
});
