import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const bin = new URL("../../../bin/underpass.ts", import.meta.url).pathname;
// Sin el flag: el propio bin debe silenciar el aviso experimental de node:sqlite.
const run = (env: Record<string, string | undefined>) => spawnSync(process.execPath, [bin, "doctor"], { env: { PATH: process.env.PATH, HOME: "", ...env }, encoding: "utf8" });

test("un error al componer sale con 1 y una línea limpia, sin pila ni aviso experimental", () => {
  const r = run({});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^underpass: .*must resolve to an absolute path/);
  assert.equal(r.stderr.includes("    at "), false);
  assert.equal(r.stderr.includes("ExperimentalWarning"), false);
});

test("UNDERPASS_DEBUG muestra la pila", () => {
  const r = run({ UNDERPASS_DEBUG: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^underpass: Error: .*absolute path[\s\S]*\n    at /);
});
