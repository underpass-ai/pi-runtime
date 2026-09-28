import { test } from "node:test";
import assert from "node:assert/strict";
import { VerifyPinnedBinaries } from "../../../../src/application/use-cases/VerifyPinnedBinaries.ts";
import { PinSetMapper } from "../../../../src/application/mappers/PinSetMapper.ts";
import { Target } from "../../../../src/domain/distribution/Target.ts";
import { Sha256Digest } from "../../../../src/domain/distribution/Sha256Digest.ts";
import type { BinaryPin } from "../../../../src/domain/distribution/BinaryPin.ts";

const good = "b".repeat(64);
const pins = new PinSetMapper().toDomain({
  pi: { package: "p", version: "1.0.0", integrity: "sha512-x=" },
  binaries: ["kmp-mcp", "made-mcp"].map((name) => ({ name, version: "1.0.0", repo: "o/r",
    sha256: Object.fromEntries(Target.all().map((t) => [t.value, good])) })),
});
const target = Target.of("aarch64-unknown-linux-gnu");

class ReadOnlyInstallation {
  readonly present = new Set<string>(); readonly writes: string[] = [];
  pathOf(p: BinaryPin) { return `/bin/${p.installedFileName()}`; }
  stagingPathOf(p: BinaryPin) { this.writes.push(`staging ${p.installedFileName()}`); return `/bin/.${p.installedFileName()}.partial`; }
  exists(p: BinaryPin) { return this.present.has(p.installedFileName()); }
  commit(p: BinaryPin) { this.writes.push(`commit ${p.installedFileName()}`); }
  discard(p: BinaryPin) { this.writes.push(`discard ${p.installedFileName()}`); }
}

test("sólo verifica: verified, missing o mismatch por binario, sin descargar ni escribir", async () => {
  const inst = new ReadOnlyInstallation();
  inst.present.add("kmp-mcp-1.0.0");
  const res = await new VerifyPinnedBinaries(pins, target, { sha256: async () => Sha256Digest.of(good) }, inst).execute();
  assert.deepEqual(res.map((r) => [r.name.value, r.path, r.status]), [["kmp-mcp", "/bin/kmp-mcp-1.0.0", "verified"], ["made-mcp", "/bin/made-mcp-1.0.0", "missing"]]);
  assert.deepEqual(inst.writes, []);
});

test("un binario alterado se reporta como mismatch", async () => {
  const inst = new ReadOnlyInstallation();
  inst.present.add("kmp-mcp-1.0.0"); inst.present.add("made-mcp-1.0.0");
  const digester = { sha256: async (path: string) => Sha256Digest.of(path.includes("made") ? "d".repeat(64) : good) };
  const res = await new VerifyPinnedBinaries(pins, target, digester, inst).execute();
  assert.deepEqual(res.map((r) => r.status), ["verified", "mismatch"]);
  assert.deepEqual(inst.writes, []);
});
