import { test } from "node:test";
import assert from "node:assert/strict";
import { McpToolMapper } from "../../../../src/application/mappers/McpToolMapper.ts";
import type { McpConnection } from "../../../../src/application/ports/McpConnection.ts";
import { DiagnoseInstallation } from "../../../../src/application/use-cases/DiagnoseInstallation.ts";
import { DiscoverMadeCapabilities } from "../../../../src/application/use-cases/DiscoverMadeCapabilities.ts";
import type { VerifyPinnedBinaries } from "../../../../src/application/use-cases/VerifyPinnedBinaries.ts";
import { VerifyServerProfiles } from "../../../../src/application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { Check } from "../../../../src/domain/diagnosis/Check.ts";
import { CheckDetail } from "../../../../src/domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../../../src/domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../../../src/domain/diagnosis/CheckSection.ts";
import { BinaryName } from "../../../../src/domain/distribution/BinaryName.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";

const profiles = ToolProfiles.standard();
const connection = (s: ServerName) => ({ server: s, identity: ServerIdentity.of("x", SemVer.of("0.8.0")), protocol: null as never, onExit() {}, close: async () => {},
  catalog: async () => ToolCatalog.of(s, ServerIdentity.of("x", SemVer.of("1.0.0")),
    [...new Set(profiles.forServer(s).flatMap((p) => p.required.map(String)))].map((n) => new McpToolMapper().toDomain({ name: n, inputSchema: {} }))),
  call: async () => ToolSuccess.of({ schema_version: "1.0", server: { version: "0.8.0" }, declared_limits: [{ id: "agent_roster_is_process_local" }] }, "") });

test("doctor añade [made-auth] con la misma conexión de MADE que usan los demás checks", async () => {
  const seen: (McpConnection | null)[] = []; const opened: McpConnection[] = [];
  const madeAuth = { execute: async (c: McpConnection | null) => { seen.push(c); return [Check.ok(CheckSection.MADE_AUTH, CheckName.of("host authorization"), CheckDetail.of("ok"))]; } };
  const doctor = new DiagnoseInstallation(
    { execute: async () => [{ name: BinaryName.KMP, path: "/b/k", status: "verified" }, { name: BinaryName.MADE, path: "/b/m", status: "verified" }] } as unknown as VerifyPinnedBinaries,
    { version: async () => SemVer.of("0.87.1") }, { install: async () => {}, isRegistered: async () => true }, { doctor: async () => true } as never,
    { load: () => new Map(), save: () => {} }, async (s) => { const c = connection(s); opened.push(c as never); return c as never; }, new VerifyServerProfiles(profiles),
    new DiscoverMadeCapabilities(), SemVer.of("0.87.1"), null, madeAuth);
  const report = await doctor.execute(false);
  assert.equal(seen.length, 1);
  assert.ok(seen[0] === opened[1], "la conexión de MADE, no la de KMP");
  assert.deepEqual(report.checks().filter((c) => c.section.equals(CheckSection.MADE_AUTH)).map((c) => c.name.value), ["host authorization"]);
  assert.equal(CheckSection.of("made-auth"), CheckSection.MADE_AUTH);
});
