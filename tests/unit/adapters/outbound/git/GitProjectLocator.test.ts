import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitProjectLocator } from "../../../../../src/adapters/outbound/git/GitProjectLocator.ts";

test("un subdirectorio resuelve al mismo proyecto que la raíz del repo", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-")));
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, "a/b"), { recursive: true });
  const loc = new GitProjectLocator();
  assert.equal(loc.locate(root).root.value, root);
  assert.ok(loc.locate(join(root, "a/b")).id.equals(loc.locate(root).id));
});

test("fuera de un repo, el proyecto es el propio directorio", () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "norepo-")));
  assert.equal(new GitProjectLocator().locate(d).root.value, d);
});
