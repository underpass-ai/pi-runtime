import { test } from "node:test";
import assert from "node:assert/strict";
import { EnsureMadeConfiguration } from "../../../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import { MadeConfiguration } from "../../../../src/domain/made/MadeConfiguration.ts";

class MemoryRepo {
  stored: MadeConfiguration | null = null; creates = 0;
  load() { return this.stored; }
  create(_s: StorePath, c: MadeConfiguration) { this.stored = c; this.creates++; }
  locationOf() { return "/cfg/x.env"; }
}

test("crea una vez y reutiliza sin rotar", () => {
  const repo = new MemoryRepo();
  const uc = new EnsureMadeConfiguration(repo, { bytes: (n) => new Uint8Array(n).fill(7) });
  const store = StorePath.of("/s/ceremonies.sqlite3");
  const a = uc.execute(store);
  const b = uc.execute(store);
  assert.deepEqual([a.created, b.created, repo.creates], [true, false, 1]);
  assert.equal(b.configuration, a.configuration);
  assert.equal(a.location, "/cfg/x.env");
});

test("carrera EEXIST en create(): recarga y devuelve created:false", () => {
  const concurrent = MadeConfiguration.generateFor(StorePath.of("/s/ceremonies.sqlite3"), new Uint8Array(32).fill(2));
  class RacyRepo {
    loads = 0;
    load() { this.loads++; return this.loads === 1 ? null : concurrent; }
    create() { const e: Error & { code?: string } = new Error("EEXIST"); e.code = "EEXIST"; throw e; }
    locationOf() { return "/cfg/x.env"; }
  }
  const repo = new RacyRepo();
  const uc = new EnsureMadeConfiguration(repo, { bytes: (n) => new Uint8Array(n).fill(7) });
  const result = uc.execute(StorePath.of("/s/ceremonies.sqlite3"));
  assert.equal(result.created, false);
  assert.equal(result.configuration, concurrent);
});

test("create() lanza un error que no es EEXIST: se propaga", () => {
  class FailingRepo {
    load() { return null; }
    create() { throw new Error("disk full"); }
    locationOf() { return "/cfg/x.env"; }
  }
  const repo = new FailingRepo();
  const uc = new EnsureMadeConfiguration(repo, { bytes: (n) => new Uint8Array(n).fill(7) });
  assert.throws(() => uc.execute(StorePath.of("/s/ceremonies.sqlite3")), /disk full/);
});
