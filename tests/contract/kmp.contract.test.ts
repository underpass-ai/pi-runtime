import { test } from "node:test";
import assert from "node:assert/strict";
import { KMP_BIN, openKmp } from "./support.ts";
import { VerifyServerProfiles } from "../../src/application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../../src/domain/contracts/ToolProfiles.ts";
import { ToolName } from "../../src/domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../src/domain/mcp/ToolRefusal.ts";

const skip = !KMP_BIN && "UNDERPASS_KMP_MCP_BIN not set";

test("kmp-mcp 0.24.0: handshake y perfiles", { skip }, async () => {
  const c = await openKmp();
  try {
    assert.equal(c.protocol.value, "2024-11-05");
    assert.equal(c.identity.name, "underpass-kmp-mcp");
    assert.equal(c.identity.version.value, "0.24.0");
    const cat = await c.catalog();
    for (const check of new VerifyServerProfiles(ToolProfiles.standard()).execute(cat)) assert.deepEqual(check.missing().map(String), [], String(check.profile));
    console.log(`P0 kmp tools=${cat.names().length} fingerprint=${cat.fingerprint()}`);
  } finally { await c.close(); }
});

test("kmp-mcp: argumentos inválidos son negativa de negocio, no error RPC", { skip }, async () => {
  const c = await openKmp();
  try { assert.ok((await c.call(ToolName.of("kmp_inspect"), {})) instanceof ToolRefusal); }
  finally { await c.close(); }
});
