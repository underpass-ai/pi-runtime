import { test } from "node:test";
import assert from "node:assert/strict";
import { EnsureMadeConfiguration } from "../../../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import type { MadeConfiguration } from "../../../../src/domain/made/MadeConfiguration.ts";

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
