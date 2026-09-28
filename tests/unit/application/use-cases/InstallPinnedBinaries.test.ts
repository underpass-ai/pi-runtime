import { test } from "node:test";
import assert from "node:assert/strict";
import { InstallPinnedBinaries } from "../../../../src/application/use-cases/InstallPinnedBinaries.ts";
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

class FakeInstallation {
  readonly present = new Set<string>(); readonly committed: string[] = []; readonly discarded: string[] = [];
  pathOf(p: BinaryPin) { return `/bin/${p.installedFileName()}`; }
  stagingPathOf(p: BinaryPin) { return `/bin/.${p.installedFileName()}.partial`; }
  exists(p: BinaryPin) { return this.present.has(p.installedFileName()); }
  commit(p: BinaryPin) { this.committed.push(p.installedFileName()); }
  discard(p: BinaryPin) { this.discarded.push(p.installedFileName()); }
}

test("verifica lo instalado y descarga sólo lo que falta", async () => {
  const inst = new FakeInstallation(); inst.present.add("kmp-mcp-1.0.0");
  const urls: string[] = [];
  const uc = new InstallPinnedBinaries(pins, target, { download: async (u) => { urls.push(u.href); } }, { sha256: async () => Sha256Digest.of(good) }, inst);
  const res = await uc.execute();
  assert.deepEqual(res.map((r) => [r.name.value, r.action]), [["kmp-mcp", "verified"], ["made-mcp", "installed"]]);
  assert.deepEqual(urls, ["https://github.com/o/r/releases/download/v1.0.0/made-mcp-v1.0.0-aarch64-unknown-linux-gnu"]);
  assert.deepEqual(inst.committed, ["made-mcp-1.0.0"]);
});

test("un digest distinto descarta la descarga y falla", async () => {
  const inst = new FakeInstallation();
  const uc = new InstallPinnedBinaries(pins, target, { download: async () => {} }, { sha256: async () => Sha256Digest.of("c".repeat(64)) }, inst);
  await assert.rejects(uc.execute(), /sha256 mismatch for kmp-mcp/);
  assert.deepEqual(inst.committed, []);
  assert.deepEqual(inst.discarded, ["kmp-mcp-1.0.0"]);
});

test("un binario instalado pero alterado se vuelve a descargar", async () => {
  const inst = new FakeInstallation(); inst.present.add("kmp-mcp-1.0.0"); inst.present.add("made-mcp-1.0.0");
  let calls = 0;
  const digester = { sha256: async (path: string) => Sha256Digest.of(path.endsWith(".partial") || calls++ > 0 ? good : "d".repeat(64)) };
  const uc = new InstallPinnedBinaries(pins, target, { download: async () => {} }, digester, inst);
  const res = await uc.execute();
  assert.equal(res[0].action, "installed");
});
