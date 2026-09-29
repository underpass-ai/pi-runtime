import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { ProfileId } from "../../../../src/domain/contracts/ProfileId.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolDescriptor } from "../../../../src/domain/mcp/ToolDescriptor.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolDescription } from "../../../../src/domain/mcp/ToolDescription.ts";
import { JsonSchema } from "../../../../src/domain/mcp/JsonSchema.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const catalogWith = (server: ServerName, names: string[]) => ToolCatalog.of(server, ServerIdentity.of("s", SemVer.of("1.0.0")),
  names.map((n) => ToolDescriptor.of(ToolName.of(n), ToolDescription.of(n), JsonSchema.of({ type: "object" }))));

test("perfiles estándar por servidor", () => {
  const p = ToolProfiles.standard();
  assert.deepEqual(p.forServer(ServerName.KMP).map((x) => x.id.value), ["kmp-interactive", "kmp-projection"]);
  assert.deepEqual(p.forServer(ServerName.MADE).map((x) => x.id.value), ["made-session", "made-worker"]);
  assert.throws(() => ProfileId.of("x"), DomainError);
});

test("sin renew_ceremony_step_lease el perfil de worker no se satisface", () => {
  const worker = ToolProfiles.standard().byId(ProfileId.MADE_WORKER);
  const names = worker.required.map(String).filter((n) => n !== "made_renew_ceremony_step_lease");
  const check = worker.check(catalogWith(ServerName.MADE, names));
  assert.equal(check.isSatisfied(), false);
  assert.deepEqual(check.missing().map(String), ["made_renew_ceremony_step_lease"]);
});

test("un perfil no se comprueba contra el catálogo de otro servidor", () => {
  const worker = ToolProfiles.standard().byId(ProfileId.MADE_WORKER);
  assert.throws(() => worker.check(catalogWith(ServerName.KMP, [])), /made-worker.*kmp/);
});
