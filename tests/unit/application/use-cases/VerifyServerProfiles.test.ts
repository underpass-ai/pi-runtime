import { test } from "node:test";
import assert from "node:assert/strict";
import { VerifyServerProfiles } from "../../../../src/application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { ProfileId } from "../../../../src/domain/contracts/ProfileId.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolDescriptor } from "../../../../src/domain/mcp/ToolDescriptor.ts";
import { ToolDescription } from "../../../../src/domain/mcp/ToolDescription.ts";
import { JsonSchema } from "../../../../src/domain/mcp/JsonSchema.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";

test("comprueba todos los perfiles del servidor del catálogo", () => {
  const profiles = ToolProfiles.standard();
  const names = profiles.byId(ProfileId.KMP_INTERACTIVE).required;
  const cat = ToolCatalog.of(ServerName.KMP, ServerIdentity.of("k", SemVer.of("0.24.0")), names.map((n) => ToolDescriptor.of(n, ToolDescription.of(n.value), JsonSchema.of({}))));
  const checks = new VerifyServerProfiles(profiles).execute(cat);
  assert.deepEqual(checks.map((c) => [c.profile.value, c.isSatisfied()]), [["kmp-interactive", true], ["kmp-projection", false]]);
});
