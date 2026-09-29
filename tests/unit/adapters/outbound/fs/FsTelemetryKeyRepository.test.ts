import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsTelemetryKeyRepository } from "../../../../../src/adapters/outbound/fs/FsTelemetryKeyRepository.ts";
import { TelemetryKeyError } from "../../../../../src/application/ports/TelemetryKeyError.ts";
import { TelemetryKey } from "../../../../../src/domain/telemetry/TelemetryKey.ts";

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const file = join(home, "state", "pi-runtime", "telemetry.key");
  return { home, file, repo: new FsTelemetryKeyRepository(file) };
};
const KEY = TelemetryKey.of("ab".repeat(32));
const pathFree = (file: string) => (e: Error) => e instanceof TelemetryKeyError && !e.message.includes(file) && !e.message.includes("ab".repeat(4));

test("sin fichero no hay clave; se crea en 0600 dentro de un directorio 0700 y se relee igual", () => {
  const { file, repo } = setup();
  assert.equal(repo.load(), null);
  repo.create(KEY);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(file, "..")).mode & 0o777, 0o700);
  assert.equal(readFileSync(file, "utf8"), `${"ab".repeat(32)}\n`);
  assert.ok(repo.load()!.equals(KEY));
  assert.deepEqual(readdirSync(join(file, "..")), ["telemetry.key"], "sin temporales");
});

test("crear sobre una clave existente no la pisa: falla con EEXIST y sin la ruta", () => {
  const { file, repo } = setup();
  repo.create(KEY);
  assert.throws(() => repo.create(TelemetryKey.of("cd".repeat(32))), (e: Error) => e instanceof TelemetryKeyError && e.code === "EEXIST" && !e.message.includes(file));
  assert.ok(repo.load()!.equals(KEY));
  assert.deepEqual(readdirSync(join(file, "..")), ["telemetry.key"]);
});

test("rechaza permisos abiertos, symlink, directorio y contenido inválido sin repetir la ruta ni el valor", () => {
  const { home, file, repo } = setup();
  repo.create(KEY);
  chmodSync(file, 0o644);
  assert.throws(() => repo.load(), pathFree(file));
  assert.throws(() => repo.load(), /mode 644/);
  chmodSync(file, 0o400);
  assert.ok(repo.load()!.equals(KEY), "0400 también vale");
  chmodSync(file, 0o600);
  writeFileSync(file, "ab".repeat(31));
  assert.throws(() => repo.load(), pathFree(file));
  rmSync(file);
  const target = join(home, "real.key"); writeFileSync(target, `${"ab".repeat(32)}\n`, { mode: 0o600 }); symlinkSync(target, file);
  assert.throws(() => repo.load(), /symlink/);
  rmSync(file);
  const dirAsFile = new FsTelemetryKeyRepository(join(home, "state"));
  assert.throws(() => dirAsFile.load(), /regular file/);
  assert.throws(() => new FsTelemetryKeyRepository("relative/telemetry.key"), (e: Error) => e instanceof TelemetryKeyError && !e.message.includes("relative"));
});

test("un directorio que no se puede escribir falla sin ruta y sin dejar temporales", () => {
  const { file, repo } = setup();
  repo.create(KEY); rmSync(file);
  const dir = join(file, "..");
  chmodSync(dir, 0o500);
  try {
    assert.throws(() => repo.create(KEY), pathFree(file));
    assert.equal(existsSync(file), false);
  } finally { chmodSync(dir, 0o700); }
  assert.deepEqual(readdirSync(dir), []);
});
