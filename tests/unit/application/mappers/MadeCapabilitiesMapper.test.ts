import { test } from "node:test";
import assert from "node:assert/strict";
import { MadeCapabilitiesMapper } from "../../../../src/application/mappers/MadeCapabilitiesMapper.ts";
import { DeclaredLimitId } from "../../../../src/domain/made/DeclaredLimitId.ts";

test("lee capabilities, declared_limits y host_activation", () => {
  const caps = new MadeCapabilitiesMapper().toDomain({
    schema_version: "1.0", server: { version: "0.8.0" }, tool_count: 104,
    capabilities: [{ id: "integrator" }], declared_limits: [{ id: "agent_roster_is_process_local" }],
    host_activation: { adapter: "none" },
  });
  assert.equal(caps.serverVersion.value, "0.8.0");
  assert.equal(caps.toolCount, 104);
  assert.deepEqual(caps.groups.map(String), ["integrator"]);
  assert.ok(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL));
  assert.equal(caps.activationAdapter, "none");
});

test("schema_version desconocido y host_activation nulo", () => {
  assert.throws(() => new MadeCapabilitiesMapper().toDomain({ schema_version: "2.0" }), /schema_version/);
  const caps = new MadeCapabilitiesMapper().toDomain({ schema_version: "1.0", server: { version: "0.8.0" }, host_activation: null });
  assert.equal(caps.activationAdapter, null);
});

test("una capability sin id rechaza el DTO", () => {
  assert.throws(() => new MadeCapabilitiesMapper().toDomain({
    schema_version: "1.0", server: { version: "0.8.0" }, capabilities: [{} as { id: string }],
  }));
});

test("un declared_limit sin id rechaza el DTO", () => {
  assert.throws(() => new MadeCapabilitiesMapper().toDomain({
    schema_version: "1.0", server: { version: "0.8.0" }, declared_limits: [{} as { id: string }],
  }));
});
