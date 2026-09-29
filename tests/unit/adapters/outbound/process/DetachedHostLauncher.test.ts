import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DetachedHostLauncher } from "../../../../../src/adapters/outbound/process/DetachedHostLauncher.ts";
import { Project } from "../../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../../src/domain/project/ProjectRoot.ts";

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const until = Date.now() + ms;
  while (!cond()) { if (Date.now() > until) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};

test("lanza el host desacoplado con cwd / y su stdout/stderr en un log 0600 del estado del proyecto, en modo append", async () => {
  const dir = mkdtempSync(join(tmpdir(), "launcher-"));
  const entry = join(dir, "entry.mjs");
  writeFileSync(entry, "console.log('cwd=' + process.cwd() + ' project=' + process.argv[2] + ' execArgv=' + JSON.stringify(process.execArgv)); console.error('to stderr');\n");
  const log = join(dir, "state", "projects", "p", "host.log");
  const launcher = new DetachedHostLauncher(entry, { PATH: process.env.PATH }, () => log);
  const project = Project.of(ProjectRoot.of("/repo"));
  launcher.launch(project);
  await waitFor(() => existsSync(log) && readFileSync(log, "utf8").includes("to stderr"));
  launcher.launch(project);
  await waitFor(() => readFileSync(log, "utf8").split("to stderr").length === 3);
  const text = readFileSync(log, "utf8");
  assert.match(text, /cwd=\/ project=\/repo/);
  assert.match(text, /execArgv=\["--disable-warning=ExperimentalWarning"\]/, "el host arranca silenciando el aviso experimental de node:sqlite");
  assert.equal(text.split("cwd=/ ").length, 3, "el segundo arranque añade, no trunca");
  assert.equal(statSync(log).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "state", "projects", "p")).mode & 0o777, 0o700);
});
