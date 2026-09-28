import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsMadeConfigurationRepository } from "../../../../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const repo = new FsMadeConfigurationRepository({ HOME: home });
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  return { home, repo, store };
};

test("ubicación compatible con el plugin de MADE; crea 0600; relee igual", () => {
  const { home, repo, store } = setup();
  assert.equal(repo.locationOf(store), join(home, ".config/underpass-made/embedded", `${store.configDigest()}.env`));
  assert.equal(repo.load(store), null);
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3));
  repo.create(store, cfg);
  assert.equal(statSync(repo.locationOf(store)).mode & 0o777, 0o600);
  assert.deepEqual(repo.load(store)!.entries(), cfg.entries());
  assert.throws(() => repo.create(store, cfg), /EEXIST/);
});

test("rechaza permisos abiertos, symlink y claves de más", () => {
  const { home, repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  const loc = repo.locationOf(store);
  chmodSync(loc, 0o644);
  assert.throws(() => repo.load(store), /mode 644/);
  chmodSync(loc, 0o600);
  writeFileSync(loc, readFileSync(loc, "utf8") + "EXTRA=1\n");
  assert.throws(() => repo.load(store), /exactly four keys/);
  const target = join(home, "real.env"); writeFileSync(target, ""); rmSync(loc); symlinkSync(target, loc);
  assert.throws(() => repo.load(store), /symlink/);
});

test("directorio padre escribible por grupo/otros: load y create rechazan", () => {
  const { home, repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  const embeddedDir = join(repo.locationOf(store), "..");
  chmodSync(embeddedDir, 0o775);
  assert.throws(() => repo.load(store), /must not be writable by group or others/);
  const other = StorePath.of(join(home, ".local/state/underpass-made/otro.sqlite3"));
  assert.throws(() => repo.create(other, MadeConfiguration.generateFor(other, new Uint8Array(32).fill(4))), /must not be writable by group or others/);
  chmodSync(embeddedDir, 0o700);
});

test("línea sin '=' en el fichero de configuración: error claro", () => {
  const { repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  const loc = repo.locationOf(store);
  writeFileSync(loc, readFileSync(loc, "utf8").replace(/\n$/, "") + "\nMALFORMED_LINE_NO_EQUALS\n");
  assert.throws(() => repo.load(store), /malformed line in made config/);
});

test("MADE_SETUP_CONFIG_ROOT y XDG_CONFIG_HOME se respetan", () => {
  const store = StorePath.of("/s/c.sqlite3");
  assert.equal(new FsMadeConfigurationRepository({ HOME: "/h", MADE_SETUP_CONFIG_ROOT: "/r" }).locationOf(store), `/r/${store.configDigest()}.env`);
  assert.equal(new FsMadeConfigurationRepository({ HOME: "/h", XDG_CONFIG_HOME: "/x" }).locationOf(store), `/x/underpass-made/embedded/${store.configDigest()}.env`);
});
