import { test } from "node:test";
import assert from "node:assert/strict";
import { TelemetryKeyError } from "../../../../src/application/ports/TelemetryKeyError.ts";
import { EnsureTelemetryKey } from "../../../../src/application/use-cases/EnsureTelemetryKey.ts";
import { TelemetryKey } from "../../../../src/domain/telemetry/TelemetryKey.ts";

class MemoryRepo {
  stored: TelemetryKey | null = null; creates = 0;
  load() { return this.stored; }
  create(k: TelemetryKey) { this.stored = k; this.creates++; }
}

test("la clave de telemetría se crea una vez con 32 bytes de entropía y se reutiliza", () => {
  const repo = new MemoryRepo(); const asked: number[] = [];
  const uc = new EnsureTelemetryKey(repo, { bytes: (n) => { asked.push(n); return new Uint8Array(n).fill(7); } });
  const a = uc.execute(); const b = uc.execute();
  assert.deepEqual([asked, repo.creates], [[32], 1]);
  assert.ok(a.equals(b));
  assert.equal(a.reveal(), "07".repeat(32));
});

test("carrera al crear (ya existe): relee la clave del otro proceso; otro fallo se propaga", () => {
  const winner = TelemetryKey.of("cd".repeat(32));
  let loads = 0;
  const racy = { load: () => (++loads === 1 ? null : winner), create: () => { throw TelemetryKeyError.exists(); } };
  assert.ok(new EnsureTelemetryKey(racy, { bytes: (n) => new Uint8Array(n) }).execute().equals(winner));
  const vanished = { load: () => null, create: () => { throw TelemetryKeyError.exists(); } };
  assert.throws(() => new EnsureTelemetryKey(vanished, { bytes: (n) => new Uint8Array(n) }).execute(), TelemetryKeyError);
  const broken = { load: () => null, create: () => { throw TelemetryKeyError.because("telemetry key could not be created (EACCES)"); } };
  assert.throws(() => new EnsureTelemetryKey(broken, { bytes: (n) => new Uint8Array(n) }).execute(), /EACCES/);
});
