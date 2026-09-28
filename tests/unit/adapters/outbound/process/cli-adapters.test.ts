import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MadeCliAuthorizationBootstrapper } from "../../../../../src/adapters/outbound/process/MadeCliAuthorizationBootstrapper.ts";
import { KmpCliLifecycle } from "../../../../../src/adapters/outbound/process/KmpCliLifecycle.ts";
import { PiCliPackageManager } from "../../../../../src/adapters/outbound/process/PiCliPackageManager.ts";
import { PiCliRuntimeInspector } from "../../../../../src/adapters/outbound/process/PiCliRuntimeInspector.ts";
import { FsFingerprintRepository } from "../../../../../src/adapters/outbound/fs/FsFingerprintRepository.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";
import { CatalogFingerprint } from "../../../../../src/domain/mcp/CatalogFingerprint.ts";

const script = (dir: string, name: string, body: string) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };

test("bootstrap de MADE pasa store y ids, nunca la clave", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bin-"));
  const log = join(dir, "args");
  const bin = script(dir, "made-mcp", `echo "$@" > ${log}; echo "authorization policy opened"`);
  const store = StorePath.of("/s/c.sqlite3");
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(5));
  assert.equal(await new MadeCliAuthorizationBootstrapper(bin).bootstrap(store, cfg), "authorization policy opened");
  const args = readFileSync(log, "utf8");
  assert.match(args, /^bootstrap-authorization \/s\/c.sqlite3 --policy-id made-local-policy-\w+ --trusted-host-id made-local-host-\w+/);
  assert.equal(args.includes(cfg.cursorKey.reveal()), false);
  await assert.rejects(new MadeCliAuthorizationBootstrapper(script(dir, "bad", "echo boom >&2; exit 1")).bootstrap(store, cfg), /boom/);
});

test("kmp lifecycle, pi package manager, pi runtime y huellas", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bin-"));
  const kmp = script(dir, "kmp-mcp", `[ "$1" = doctor ] && exit 1; exit 0`);
  assert.equal(await new KmpCliLifecycle(kmp, {}).doctor(), false);
  assert.equal(await new KmpCliLifecycle(script(dir, "kmp-ok", "exit 0"), {}).doctor(), true);
  assert.equal("setup" in new KmpCliLifecycle(kmp, {}), false, "setup no reconcilia hosts de KMP ajenos (llegará como kmp-mcp setup --pi)");
  const pi = script(dir, "pi", `case "$1" in --version) echo 0.87.1;; list) echo "  /x/underpass-pi";; install) exit 0;; esac`);
  await new PiCliPackageManager(pi).install("/x/underpass-pi");
  assert.equal(await new PiCliPackageManager(pi).isRegistered("underpass-pi"), true);
  assert.equal((await new PiCliRuntimeInspector(pi).version())!.value, "0.87.1");
  assert.equal(await new PiCliRuntimeInspector(join(dir, "missing")).version(), null);
  const repo = new FsFingerprintRepository(join(dir, "fp.json"));
  assert.equal(repo.load().size, 0);
  repo.save(new Map([["kmp", CatalogFingerprint.of("a".repeat(64))]]));
  assert.equal(repo.load().get("kmp")!.value, "a".repeat(64));
});
