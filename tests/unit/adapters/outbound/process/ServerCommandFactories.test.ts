import { test } from "node:test";
import assert from "node:assert/strict";
import { KmpServerCommandFactory } from "../../../../../src/adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeServerCommandFactory } from "../../../../../src/adapters/outbound/process/MadeServerCommandFactory.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";
import { Project } from "../../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../../src/domain/project/ProjectRoot.ts";

const project = Project.of(ProjectRoot.of("/repo"));

test("KMP: embebido y cwd en la raíz del proyecto para resolver .kernel/", () => {
  const c = new KmpServerCommandFactory("/bin/kmp-mcp", { PATH: "/usr/bin" }).commandFor(project);
  assert.deepEqual([c.command, c.args, c.cwd, c.env.KMP_MCP_BACKEND, c.env.PATH], ["/bin/kmp-mcp", [], "/repo", "embedded", "/usr/bin"]);
});

test("MADE: store, backend y las cuatro claves por entorno, nunca por argumentos", () => {
  const store = StorePath.of("/s/ceremonies.sqlite3");
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(9));
  const c = new MadeServerCommandFactory("/bin/made-mcp", store, cfg, {}).commandFor(project);
  assert.deepEqual(c.args, []);
  assert.equal(c.env.MADE_MCP_BACKEND, "embedded");
  assert.equal(c.env.MADE_MCP_STORE_PATH, "/s/ceremonies.sqlite3");
  assert.equal(c.env.MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY?.length, 64);
});
