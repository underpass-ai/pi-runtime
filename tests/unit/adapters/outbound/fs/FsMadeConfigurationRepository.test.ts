import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MadeConfigurationError } from "../../../../../src/application/ports/MadeConfigurationError.ts";
import { FsMadeConfigurationRepository } from "../../../../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const repo = new FsMadeConfigurationRepository(join(home, ".config/underpass-made/embedded"));
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

test("rechaza permisos abiertos, symlink y clave duplicada", () => {
  const { home, repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  const loc = repo.locationOf(store);
  chmodSync(loc, 0o644);
  assert.throws(() => repo.load(store), /mode 644/);
  chmodSync(loc, 0o600);
  writeFileSync(loc, readFileSync(loc, "utf8") + "MADE_AUTH_POLICY_ID=duplicate\n");
  assert.throws(() => repo.load(store), /exactly four keys/);
  const target = join(home, "real.env"); writeFileSync(target, ""); rmSync(loc); symlinkSync(target, loc);
  assert.throws(() => repo.load(store), /symlink/);
});

test("rechaza claves ausentes y claves MADE_* desconocidas", () => {
  const { repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  const loc = repo.locationOf(store);
  const withoutOne = readFileSync(loc, "utf8").split("\n").filter((l) => !l.startsWith("MADE_CEREMONY_STORE_ID=")).join("\n");
  writeFileSync(loc, withoutOne);
  assert.throws(() => repo.load(store), /exactly four keys/);
  writeFileSync(loc, readFileSync(loc, "utf8").replace(/\n$/, "") + "\nMADE_BOGUS_KEY=1\n");
  assert.throws(() => repo.load(store), /unknown key/);
});

test("tolera el comentario de cabecera del plugin de MADE y líneas en blanco", () => {
  const { repo, store } = setup();
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(7));
  const loc = repo.locationOf(store);
  mkdirSync(dirname(loc), { recursive: true, mode: 0o700 });
  const body = ["# MADE embedded host configuration; managed by made-setup.", "", ...cfg.entries().map(([k, v]) => `${k}=${v}`), ""].join("\n");
  writeFileSync(loc, body, { mode: 0o600 });
  assert.deepEqual(repo.load(store)!.entries(), cfg.entries());
});

test("create() escribe el mismo comentario de cabecera que escribe el plugin de MADE", () => {
  const { repo, store } = setup();
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(9));
  repo.create(store, cfg);
  const raw = readFileSync(repo.locationOf(store), "utf8");
  assert.match(raw, /^# MADE embedded host configuration; managed by made-setup\.\n/);
  assert.deepEqual(repo.load(store)!.entries(), cfg.entries());
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

test("recibe la raíz ya resuelta (sin leer el entorno) y exige que sea absoluta", () => {
  const store = StorePath.of("/s/c.sqlite3");
  assert.equal(new FsMadeConfigurationRepository("/r").locationOf(store), `/r/${store.configDigest()}.env`);
  assert.throws(() => new FsMadeConfigurationRepository("relative/root"), /absolute/);
});

test("los fallos de validación del fichero son MadeConfigurationError", () => {
  const { repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  chmodSync(repo.locationOf(store), 0o644);
  assert.throws(() => repo.load(store), MadeConfigurationError);
});

test("un valor inválido (clave HMAC corta) es MadeConfigurationError y no revela el valor", () => {
  const { repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  const loc = repo.locationOf(store);
  writeFileSync(loc, readFileSync(loc, "utf8").replace(/MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY=\w+/, "MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY=abc123"));
  assert.throws(() => repo.load(store), (e) => e instanceof MadeConfigurationError && /invalid value/.test(e.message) && !e.message.includes("abc123"));
});
