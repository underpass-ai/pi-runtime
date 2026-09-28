import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MadeConfigurationError } from "../../../../../src/application/ports/MadeConfigurationError.ts";
import { LazyMadeServerCommandFactory } from "../../../../../src/adapters/outbound/process/LazyMadeServerCommandFactory.ts";
import { FsMadeConfigurationRepository } from "../../../../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";
import { Project } from "../../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../../src/domain/project/ProjectRoot.ts";

const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const configs = new FsMadeConfigurationRepository(join(home, ".config/underpass-made/embedded"));
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  return { home, configs, store, factory: new LazyMadeServerCommandFactory("/bin/made-mcp", store, configs, { PATH: "/usr/bin" }) };
};
const project = Project.of(ProjectRoot.of("/repo"));

test("sin configuración privada falla pidiendo `underpass setup` y no crea nada", () => {
  const { configs, store, factory } = fixture();
  assert.throws(() => factory.commandFor(project), (e) => e instanceof MadeConfigurationError && /MADE private configuration missing; run `underpass setup`/.test(e.message));
  assert.equal(existsSync(configs.locationOf(store)), false);
});

test("con configuración la lee en cada arranque, sin tocarla, y la pasa por entorno", () => {
  const { configs, store, factory } = fixture();
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(6));
  configs.create(store, cfg);
  const cmd = factory.commandFor(project);
  assert.equal(cmd.command, "/bin/made-mcp");
  assert.deepEqual(cmd.args, []);
  assert.equal(cmd.cwd, "/repo");
  assert.equal(cmd.env.MADE_MCP_STORE_PATH, store.value);
  assert.equal(cmd.env.PATH, "/usr/bin");
  for (const [k, v] of cfg.entries()) assert.equal(cmd.env[k], v);
});
