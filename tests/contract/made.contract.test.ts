import { test } from "node:test";
import assert from "node:assert/strict";
import { MADE_BIN, openMade } from "./support.ts";
import { VerifyServerProfiles } from "../../src/application/use-cases/VerifyServerProfiles.ts";
import { MadeCapabilitiesMapper } from "../../src/application/mappers/MadeCapabilitiesMapper.ts";
import { ToolProfiles } from "../../src/domain/contracts/ToolProfiles.ts";
import { DeclaredLimitId } from "../../src/domain/made/DeclaredLimitId.ts";
import { ToolName } from "../../src/domain/mcp/ToolName.ts";
import { ToolSuccess } from "../../src/domain/mcp/ToolSuccess.ts";

const skip = !MADE_BIN && "UNDERPASS_MADE_MCP_BIN not set";

test("made-mcp 0.8.0: handshake, perfiles y capacidades", { skip }, async () => {
  const c = await openMade();
  try {
    assert.equal(c.protocol.value, "2024-11-05");
    const cat = await c.catalog();
    for (const check of new VerifyServerProfiles(ToolProfiles.standard()).execute(cat)) assert.deepEqual(check.missing().map(String), [], String(check.profile));
    const r = await c.call(ToolName.of("made_discover_capabilities"), {});
    assert.ok(r instanceof ToolSuccess);
    const caps = new MadeCapabilitiesMapper().toDomain(r.structured as never);
    assert.equal(caps.serverVersion.value, "0.8.0");
    assert.ok(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL));
    console.log(`P0 made tools=${cat.names().length} fingerprint=${cat.fingerprint()} groups=${caps.groups.join(",")} limits=${caps.limits.join(",")}`);
  } finally { await c.close(); }
});

test("made-mcp: una espera acotada retrasa la siguiente llamada en la misma conexión", { skip }, async () => {
  const c = await openMade();
  try {
    // made_pull_ceremony_events (el verbo del brief) no admite wait_timeout_ms en su inputSchema real:
    // sólo consumer/acknowledge_through/limit y responde de inmediato. made_await_integrator_attention sí
    // bloquea de forma acotada (misma familia que cita la regla para S3 en el hallazgo), así que se usa ese
    // verbo para medir el bloqueo en cabeza de cola. Requiere una concesión de autorización propia: el store
    // recién creado no trae ninguna, y hasta made_get_status la exige.
    const policy = await c.call(ToolName.of("made_get_authorization_policy"), {});
    assert.ok(policy instanceof ToolSuccess);
    const principalId = (policy.structured as { policy: { owner: { principal_id: string } } }).policy.owner.principal_id;

    const grant = await c.call(ToolName.of("made_issue_authorization_grant"), {
      grant_id: "p0-head-of-line-grant",
      grantee_id: principalId,
      actions: ["get_status", "bind_ceremony_integrator", "await_integrator_attention"],
      scope: { kind: "global" },
      valid_from: new Date().toISOString(),
      delegation_depth: 0,
    });
    assert.ok(grant instanceof ToolSuccess);

    const bind = await c.call(ToolName.of("made_bind_ceremony_integrator"), {
      binding_id: "p0-head-of-line-binding",
      scope: { kind: "system_execution", system_execution_id: "p0-head-of-line-exec" },
      role_id: "p0-role",
      host_kind: "p0-host",
      address: "stdio://p0-head-of-line",
      incarnation: "p0-incarnation-1",
    });
    assert.ok(bind instanceof ToolSuccess);

    const t0 = performance.now();
    const slow = c.call(ToolName.of("made_await_integrator_attention"), {
      scope: { kind: "system_execution", system_execution_id: "p0-head-of-line-exec" },
      binding_id: "p0-head-of-line-binding",
      incarnation: "p0-incarnation-1",
      fence: 0,
      wait_timeout_ms: 2000,
    });
    const fast = c.call(ToolName.of("made_get_status"), {}).then(() => performance.now() - t0);
    const [slowResult, ms] = await Promise.all([slow, fast]);
    assert.ok(slowResult instanceof ToolSuccess);
    console.log(`P0 made head-of-line: made_get_status answered after ${Math.round(ms)}ms behind a 2000ms wait`);
  } finally { await c.close(); }
});
