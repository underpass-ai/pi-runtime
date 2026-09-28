import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { FsBinaryInstallation } from "../../../../../src/adapters/outbound/fs/FsBinaryInstallation.ts";
import { NodeFileDigester } from "../../../../../src/adapters/outbound/fs/NodeFileDigester.ts";
import { GithubReleaseDownloader } from "../../../../../src/adapters/outbound/github/GithubReleaseDownloader.ts";
import { PinSetMapper } from "../../../../../src/application/mappers/PinSetMapper.ts";
import { BinaryName } from "../../../../../src/domain/distribution/BinaryName.ts";
import { Target } from "../../../../../src/domain/distribution/Target.ts";

const pin = new PinSetMapper().toDomain({ pi: { package: "p", version: "1.0.0", integrity: "sha512-x=" },
  binaries: [{ name: "kmp-mcp", version: "1.0.0", repo: "o/r", sha256: Object.fromEntries(Target.all().map((t) => [t.value, "a".repeat(64)])) }] }).pinFor(BinaryName.KMP);

test("commit deja el binario ejecutable en su ruta final; discard limpia", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bin-"));
  const inst = new FsBinaryInstallation(dir);
  writeFileSync(inst.stagingPathOf(pin), "#!/bin/sh\n");
  assert.match((await new NodeFileDigester().sha256(inst.stagingPathOf(pin))).value, /^[0-9a-f]{64}$/);
  inst.commit(pin);
  assert.ok(inst.exists(pin));
  assert.ok(statSync(inst.pathOf(pin)).mode & 0o100);
  writeFileSync(inst.stagingPathOf(pin), "x");
  inst.discard(pin);
  assert.equal(existsSync(inst.stagingPathOf(pin)), false);
});

test("GithubReleaseDownloader escribe el cuerpo y falla con estados de error", async () => {
  const server = createServer((req, res) => { if (req.url === "/ok") res.end("payload"); else { res.statusCode = 404; res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  const to = join(mkdtempSync(join(tmpdir(), "dl-")), "f");
  try {
    await new GithubReleaseDownloader().download(new URL(`http://127.0.0.1:${port}/ok`), to);
    assert.equal(readFileSync(to, "utf8"), "payload");
    await assert.rejects(new GithubReleaseDownloader().download(new URL(`http://127.0.0.1:${port}/missing`), to), /404/);
  } finally { server.close(); }
});

test("construirla y consultarla no crea nada en disco; sólo instalar crea el directorio", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "bin-")), "nested", "bin");
  const inst = new FsBinaryInstallation(dir);
  assert.equal(inst.exists(pin), false);
  assert.equal(existsSync(dir), false);
  inst.stagingPathOf(pin);
  assert.equal(existsSync(dir), true);
});
