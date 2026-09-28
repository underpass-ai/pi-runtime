import { test } from "node:test";
import assert from "node:assert/strict";
import { SetupInstallation } from "../../../../src/application/use-cases/SetupInstallation.ts";
import { DiagnoseInstallation } from "../../../../src/application/use-cases/DiagnoseInstallation.ts";
import { BootstrapMadeAuthorization } from "../../../../src/application/use-cases/BootstrapMadeAuthorization.ts";
import { EnsureMadeConfiguration } from "../../../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { InstallPinnedBinaries } from "../../../../src/application/use-cases/InstallPinnedBinaries.ts";
import { VerifyServerProfiles } from "../../../../src/application/use-cases/VerifyServerProfiles.ts";
import { DiscoverMadeCapabilities } from "../../../../src/application/use-cases/DiscoverMadeCapabilities.ts";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { McpToolMapper } from "../../../../src/application/mappers/McpToolMapper.ts";
import type { MadeConfiguration } from "../../../../src/domain/made/MadeConfiguration.ts";

const store = StorePath.of("/s/ceremonies.sqlite3");
const profiles = ToolProfiles.standard();
const catalogFor = (s: ServerName) => ToolCatalog.of(s, ServerIdentity.of("x", SemVer.of("1.0.0")),
  [...new Set(profiles.forServer(s).flatMap((p) => p.required.map(String)))].map((n) => new McpToolMapper().toDomain({ name: n, inputSchema: {} })));
const connection = (s: ServerName) => ({ server: s, identity: ServerIdentity.of("x", SemVer.of("0.8.0")), protocol: null as never, onExit() {}, close: async () => {},
  catalog: async () => catalogFor(s),
  call: async () => ToolSuccess.of({ schema_version: "1.0", server: { version: "0.8.0" }, declared_limits: [{ id: "agent_roster_is_process_local" }] }, "") });

function deps(overrides: Record<string, unknown> = {}) {
  let saved: Map<string, unknown> | null = null;
  const repo = { stored: null as MadeConfiguration | null, load() { return this.stored; }, create(_s: StorePath, c: MadeConfiguration) { this.stored = c; }, locationOf: () => "/cfg" };
  return {
    install: { execute: async () => [] } as unknown as InstallPinnedBinaries,
    ensure: new EnsureMadeConfiguration(repo, { bytes: (k) => new Uint8Array(k) }),
    bootstrap: new BootstrapMadeAuthorization({ bootstrap: async () => "authorization policy opened" }),
    kmp: { setup: async () => {}, doctor: async () => true },
    pi: { install: async () => {}, isRegistered: async () => true },
    runtime: { version: async () => SemVer.of("0.87.1") },
    fingerprints: { load: () => new Map(), save: (m: Map<string, unknown>) => { saved = m; } },
    connections: async (s: ServerName) => connection(s),
    saved: () => saved,
    ...overrides,
  };
}

test("setup encadena todo y no falla con dobles sanos", async () => {
  const d = deps();
  const r = await new SetupInstallation(d.install, d.ensure, d.bootstrap, d.kmp, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), false);
  assert.deepEqual(r.checks().map((c) => c.name.value), ["pinned binaries", "private configuration", "authorization bootstrap", "kmp-mcp setup", "underpass-pi package"]);
});

test("setup se detiene si la descarga falla", async () => {
  const d = deps({ install: { execute: async () => { throw new Error("sha256 mismatch for kmp-mcp"); } } });
  const r = await new SetupInstallation(d.install as never, d.ensure, d.bootstrap, d.kmp, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), true);
  assert.equal(r.checks().length, 1);
});

test("doctor verifica perfiles, capacidades y registra huellas", async () => {
  const d = deps();
  const doctor = new DiagnoseInstallation(d.install, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1"));
  const r = await doctor.execute(true);
  assert.equal(r.hasFailures(), false, JSON.stringify(r.checks().map((c) => [c.name.value, c.status.value, c.detail.value])));
  assert.deepEqual([...d.saved()!.keys()], ["kmp", "made"]);
});

test("doctor marca FAIL con Pi ausente o de otra versión, y WARN si kmp doctor avisa", async () => {
  const d = deps({ runtime: { version: async () => null }, kmp: { setup: async () => {}, doctor: async () => false } });
  const r = await new DiagnoseInstallation(d.install, d.runtime as never, d.pi, d.kmp as never, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1")).execute(false);
  assert.equal(r.hasFailures(), true);
  assert.ok(r.checks().some((c) => c.name.value === "kmp-mcp doctor" && c.status.value === "WARN"));
  assert.equal(d.saved(), null);
});

test("setup convierte un fallo al leer la configuración privada de MADE en un check FAIL, sin excepción", async () => {
  const brokenRepo = { load() { throw new Error("made config /cfg contains an unknown key MADE_BOGUS"); }, create() {}, locationOf: () => "/cfg" };
  const d = deps({ ensure: new EnsureMadeConfiguration(brokenRepo as never, { bytes: (k: number) => new Uint8Array(k) }) });
  const r = await new SetupInstallation(d.install, d.ensure, d.bootstrap, d.kmp, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), true);
  assert.deepEqual(r.checks().map((c) => c.name.value), ["pinned binaries", "private configuration"]);
  const failed = r.checks().find((c) => c.name.value === "private configuration")!;
  assert.equal(failed.section.value, "made");
  assert.match(failed.detail.value, /unknown key MADE_BOGUS/);
});

test("doctor convierte un fallo de conexión a MADE por configuración rota en un check FAIL, sin excepción", async () => {
  const d = deps({ connections: async (s: ServerName) => { if (s.equals(ServerName.MADE)) throw new Error("made config /cfg must contain exactly four keys"); return connection(s); } });
  const doctor = new DiagnoseInstallation(d.install, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1"));
  const r = await doctor.execute(true);
  assert.equal(r.hasFailures(), true);
  const failed = r.checks().find((c) => c.name.value === "private configuration" && c.section.value === "made")!;
  assert.ok(failed, JSON.stringify(r.checks().map((c) => [c.section.value, c.name.value, c.status.value])));
  assert.equal(failed.status.value, "FAIL");
  assert.match(failed.detail.value, /exactly four keys/);
});
