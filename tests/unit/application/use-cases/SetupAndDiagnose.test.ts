import { test } from "node:test";
import assert from "node:assert/strict";
import { SetupInstallation } from "../../../../src/application/use-cases/SetupInstallation.ts";
import { DiagnoseInstallation } from "../../../../src/application/use-cases/DiagnoseInstallation.ts";
import { BootstrapMadeAuthorization } from "../../../../src/application/use-cases/BootstrapMadeAuthorization.ts";
import { EnsureMadeConfiguration } from "../../../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { InstallPinnedBinaries } from "../../../../src/application/use-cases/InstallPinnedBinaries.ts";
import type { VerifyPinnedBinaries } from "../../../../src/application/use-cases/VerifyPinnedBinaries.ts";
import { BinaryName } from "../../../../src/domain/distribution/BinaryName.ts";
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
import { Check } from "../../../../src/domain/diagnosis/Check.ts";
import { CheckDetail } from "../../../../src/domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../../../src/domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../../../src/domain/diagnosis/CheckSection.ts";
import { MadeConfigurationError } from "../../../../src/application/ports/MadeConfigurationError.ts";

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
    verify: { execute: async () => [{ name: BinaryName.KMP, path: "/b/k", status: "verified" }, { name: BinaryName.MADE, path: "/b/m", status: "verified" }] } as unknown as VerifyPinnedBinaries,
    ensure: new EnsureMadeConfiguration(repo, { bytes: (k) => new Uint8Array(k) }),
    bootstrap: new BootstrapMadeAuthorization({ bootstrap: async () => "authorization policy opened" }),
    kmp: { doctor: async () => true },
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
  const r = await new SetupInstallation(d.install, d.ensure, d.bootstrap, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), false);
  assert.deepEqual(r.checks().map((c) => c.name.value), ["pinned binaries", "private configuration", "authorization bootstrap", "pi-runtime package"]);
});

test("setup se detiene si la descarga falla", async () => {
  const d = deps({ install: { execute: async () => { throw new Error("sha256 mismatch for kmp-mcp"); } } });
  const r = await new SetupInstallation(d.install as never, d.ensure, d.bootstrap, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), true);
  assert.equal(r.checks().length, 1);
});

test("doctor verifica perfiles, capacidades y registra huellas", async () => {
  const d = deps();
  const doctor = new DiagnoseInstallation(d.verify, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1"));
  const r = await doctor.execute(true);
  assert.equal(r.hasFailures(), false, JSON.stringify(r.checks().map((c) => [c.name.value, c.status.value, c.detail.value])));
  assert.deepEqual([...d.saved()!.keys()], ["kmp", "made"]);
});

test("doctor marca FAIL con Pi ausente o de otra versión, y WARN si kmp doctor avisa", async () => {
  const d = deps({ runtime: { version: async () => null }, kmp: { doctor: async () => false } });
  const r = await new DiagnoseInstallation(d.verify, d.runtime as never, d.pi, d.kmp as never, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1")).execute(false);
  assert.equal(r.hasFailures(), true);
  assert.ok(r.checks().some((c) => c.name.value === "kmp-mcp doctor" && c.status.value === "WARN"));
  assert.equal(d.saved(), null);
});

test("setup convierte un fallo al leer la configuración privada de MADE en un check FAIL, sin excepción", async () => {
  const brokenRepo = { load() { throw new Error("made config /cfg contains an unknown key MADE_BOGUS"); }, create() {}, locationOf: () => "/cfg" };
  const d = deps({ ensure: new EnsureMadeConfiguration(brokenRepo as never, { bytes: (k: number) => new Uint8Array(k) }) });
  const r = await new SetupInstallation(d.install, d.ensure, d.bootstrap, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), true);
  assert.deepEqual(r.checks().map((c) => c.name.value), ["pinned binaries", "private configuration"]);
  const failed = r.checks().find((c) => c.name.value === "private configuration")!;
  assert.equal(failed.section.value, "made");
  assert.match(failed.detail.value, /unknown key MADE_BOGUS/);
});

test("doctor convierte un fallo de conexión a MADE por configuración rota en un check FAIL, sin excepción", async () => {
  const d = deps({ connections: async (s: ServerName) => { if (s.equals(ServerName.MADE)) throw new MadeConfigurationError("made config /cfg must contain exactly four keys"); return connection(s); } });
  const doctor = new DiagnoseInstallation(d.verify, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1"));
  const r = await doctor.execute(true);
  assert.equal(r.hasFailures(), true);
  const failed = r.checks().find((c) => c.name.value === "private configuration" && c.section.value === "made")!;
  assert.ok(failed, JSON.stringify(r.checks().map((c) => [c.section.value, c.name.value, c.status.value])));
  assert.equal(failed.status.value, "FAIL");
  assert.match(failed.detail.value, /exactly four keys/);
});

test("doctor aísla un fallo de catálogo de un servidor: FAIL 'server contract' y sigue con el otro servidor y kmp-mcp doctor", async () => {
  let closed = 0;
  const d = deps({
    connections: async (s: ServerName) => {
      if (s.equals(ServerName.KMP)) {
        return { ...connection(s), catalog: async () => { throw new Error("kmp exited (2): protocol handshake timed out"); }, close: async () => { closed++; } };
      }
      return { ...connection(s), close: async () => { closed++; } };
    },
  });
  const doctor = new DiagnoseInstallation(d.verify, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1"));
  const r = await doctor.execute(false);
  assert.equal(r.hasFailures(), true);
  const failed = r.checks().find((c) => c.name.value === "server contract" && c.section.value === "kmp")!;
  assert.ok(failed, JSON.stringify(r.checks().map((c) => [c.section.value, c.name.value, c.status.value])));
  assert.equal(failed.status.value, "FAIL");
  assert.match(failed.detail.value, /protocol handshake timed out/);
  assert.ok(r.checks().some((c) => c.section.value === "made" && c.name.value === "capabilities"), "el servidor made sigue diagnosticándose");
  assert.ok(r.checks().some((c) => c.name.value === "kmp-mcp doctor"), "kmp-mcp doctor sigue ejecutándose");
  assert.equal(closed, 2, "ambas conexiones se cierran igual, incluida la que falló");
});

test("doctor nunca instala: sólo verifica, y un binario ausente o alterado es FAIL que pide `underpass update`", async () => {
  let installs = 0; let connects = 0;
  const d = deps({
    install: { execute: async () => { installs++; return []; } },
    verify: { execute: async () => [{ name: BinaryName.KMP, path: "/b/k", status: "missing" }, { name: BinaryName.MADE, path: "/b/m", status: "mismatch" }] },
    connections: async (s: ServerName) => { connects++; return connection(s); },
  });
  const r = await new DiagnoseInstallation(d.verify as never, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1")).execute(false);
  const failed = r.checks().find((c) => c.name.value === "pinned binaries")!;
  assert.equal(failed.status.value, "FAIL");
  assert.match(failed.detail.value, /kmp-mcp missing/);
  assert.match(failed.detail.value, /made-mcp mismatch/);
  assert.match(failed.detail.value, /run `underpass update`/);
  assert.equal(installs, 0);
  assert.equal(connects, 0, "sin binarios verificados no se arranca ningún servidor");
});

test("doctor etiqueta un fallo de arranque de cualquier servidor como 'server connection', no como configuración privada", async () => {
  const d = deps({ connections: async (s: ServerName) => { throw new Error(`${s.value} failed to start: spawn ENOENT`); } });
  const r = await new DiagnoseInstallation(d.verify, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1")).execute(false);
  for (const server of ["kmp", "made"]) {
    const failed = r.checks().find((c) => c.section.value === server && c.name.value === "server connection");
    assert.ok(failed, JSON.stringify(r.checks().map((c) => [c.section.value, c.name.value])));
    assert.equal(failed.status.value, "FAIL");
  }
  assert.equal(r.checks().some((c) => c.name.value === "private configuration"), false);
});

test("doctor añade los checks del log de eventos al final; si fallan, FAIL en 'event log'", async () => {
  const d = deps();
  const build = (eventLog: { execute(): Check[] }) => new DiagnoseInstallation(d.verify, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections,
    new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1"), eventLog);
  const ok = await build({ execute: () => [Check.ok(CheckSection.EVENTS, CheckName.of("event log"), CheckDetail.of("3 events, 1 streams"))] }).execute(false);
  const last = ok.checks().at(-1)!;
  assert.deepEqual([last.section.value, last.name.value, last.status.value], ["events", "event log", "OK"]);
  assert.equal(ok.hasFailures(), false);
  const broken = await build({ execute: () => { throw new Error("database is locked"); } }).execute(false);
  const failed = broken.checks().find((c) => c.section.value === "events" && c.name.value === "event log")!;
  assert.equal(failed.status.value, "FAIL");
  assert.match(failed.detail.value, /database is locked/);
});

test("doctor también informa del log de eventos cuando los binarios fijados fallan", async () => {
  const d = deps({ verify: { execute: async () => [{ name: BinaryName.KMP, path: "/b/k", status: "missing" }, { name: BinaryName.MADE, path: "/b/m", status: "verified" }] } });
  const r = await new DiagnoseInstallation(d.verify as never, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles),
    new DiscoverMadeCapabilities(), SemVer.of("0.87.1"), { execute: () => [Check.warn(CheckSection.EVENTS, CheckName.of("event log"), CheckDetail.of("no events recorded yet"))] }).execute(false);
  assert.ok(r.checks().some((c) => c.name.value === "pinned binaries" && c.status.value === "FAIL"));
  assert.ok(r.checks().some((c) => c.section.value === "events" && c.status.value === "WARN"));
});
