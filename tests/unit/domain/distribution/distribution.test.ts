import { test } from "node:test";
import assert from "node:assert/strict";
import { Target } from "../../../../src/domain/distribution/Target.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { Sha256Digest } from "../../../../src/domain/distribution/Sha256Digest.ts";
import { Sha512Integrity } from "../../../../src/domain/distribution/Sha512Integrity.ts";
import { RepositorySlug } from "../../../../src/domain/distribution/RepositorySlug.ts";
import { BinaryName } from "../../../../src/domain/distribution/BinaryName.ts";
import { NpmPackageName } from "../../../../src/domain/distribution/NpmPackageName.ts";
import { BinaryPin } from "../../../../src/domain/distribution/BinaryPin.ts";
import { PiPin } from "../../../../src/domain/distribution/PiPin.ts";
import { PinSet } from "../../../../src/domain/distribution/PinSet.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const hex = "a".repeat(64);
const digests = () => new Map(Target.all().map((t) => [t.value, Sha256Digest.of(hex)]));
const kmpPin = () => BinaryPin.of({ name: BinaryName.KMP, version: SemVer.of("0.24.0"), repository: RepositorySlug.of("underpass-ai/kmp"), digests: digests() });

test("Target: detecta y valida", () => {
  assert.equal(Target.detect("linux", "arm64").value, "aarch64-unknown-linux-gnu");
  assert.equal(Target.detect("linux", "x64").value, "x86_64-unknown-linux-gnu");
  assert.equal(Target.detect("darwin", "arm64").value, "aarch64-apple-darwin");
  assert.throws(() => Target.detect("win32", "x64"), DomainError);
  assert.throws(() => Target.of("mips"), DomainError);
});

test("VOs rechazan formatos inválidos", () => {
  assert.throws(() => SemVer.of("1.0"), DomainError);
  assert.throws(() => Sha256Digest.of("xyz"), DomainError);
  assert.throws(() => Sha512Integrity.of("sha256-abc"), DomainError);
  assert.throws(() => RepositorySlug.of("nope"), DomainError);
  assert.throws(() => BinaryName.of("other-mcp"), DomainError);
  assert.throws(() => NpmPackageName.of("Bad Name"), DomainError);
  assert.equal(Sha256Digest.of(hex.toUpperCase()).value, hex);
});

test("BinaryPin: asset, url, digest y fichero instalado", () => {
  const pin = kmpPin();
  const t = Target.of("aarch64-unknown-linux-gnu");
  assert.equal(pin.assetName(t), "kmp-mcp-v0.24.0-aarch64-unknown-linux-gnu");
  assert.equal(pin.releaseUrl(t).href, "https://github.com/underpass-ai/kmp/releases/download/v0.24.0/kmp-mcp-v0.24.0-aarch64-unknown-linux-gnu");
  assert.ok(pin.digestFor(t).equals(Sha256Digest.of(hex)));
  assert.equal(pin.installedFileName(), "kmp-mcp-0.24.0");
});

test("BinaryPin exige digest para todos los targets", () => {
  assert.throws(() => BinaryPin.of({ name: BinaryName.KMP, version: SemVer.of("1.0.0"), repository: RepositorySlug.of("a/b"), digests: new Map() }), /digest/);
});

test("PinSet: busca por nombre y rechaza duplicados o ausencias", () => {
  const pi = PiPin.of({ packageName: NpmPackageName.of("@earendil-works/pi-coding-agent"), version: SemVer.of("0.87.1"), integrity: Sha512Integrity.of("sha512-abc=") });
  const set = PinSet.of(pi, [kmpPin()]);
  assert.equal(set.pinFor(BinaryName.KMP).version.value, "0.24.0");
  assert.throws(() => set.pinFor(BinaryName.MADE), DomainError);
  assert.throws(() => PinSet.of(pi, [kmpPin(), kmpPin()]), /duplicate/);
  assert.equal(set.pi.version.value, "0.87.1");
});

test("los VOs de distribución rechazan entradas que no son string", async () => {
  const { AdvisoryId } = await import("../../../../src/domain/distribution/AdvisoryId.ts");
  const factories: [string, (raw: never) => unknown][] = [
    ["SemVer", (r) => SemVer.of(r)], ["Sha256Digest", (r) => Sha256Digest.of(r)], ["Sha512Integrity", (r) => Sha512Integrity.of(r)],
    ["RepositorySlug", (r) => RepositorySlug.of(r)], ["NpmPackageName", (r) => NpmPackageName.of(r)], ["AdvisoryId", (r) => AdvisoryId.of(r)], ["Target", (r) => Target.of(r)],
  ];
  for (const raw of [["1.0.0"], ["a/b"], ["GHSA-x"], 5, null, undefined]) {
    for (const [name, factory] of factories) assert.throws(() => factory(raw as never), DomainError, `${name}(${JSON.stringify(raw)})`);
  }
});
