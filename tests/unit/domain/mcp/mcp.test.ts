import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolDescription } from "../../../../src/domain/mcp/ToolDescription.ts";
import { JsonSchema } from "../../../../src/domain/mcp/JsonSchema.ts";
import { ToolDescriptor } from "../../../../src/domain/mcp/ToolDescriptor.ts";
import { ProtocolVersion } from "../../../../src/domain/mcp/ProtocolVersion.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { CatalogFingerprint } from "../../../../src/domain/mcp/CatalogFingerprint.ts";
import { RefusalCode } from "../../../../src/domain/mcp/RefusalCode.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const tool = (n: string, schema: Record<string, unknown> = { type: "object" }) => ToolDescriptor.of(ToolName.of(n), ToolDescription.of(n), JsonSchema.of(schema));
const identity = ServerIdentity.of("underpass-kmp-mcp", SemVer.of("0.24.0"));

test("VOs MCP validan", () => {
  assert.throws(() => ServerName.of("x"), DomainError);
  assert.throws(() => ToolName.of("Bad-Name"), DomainError);
  assert.throws(() => ToolDescription.of(""), DomainError);
  assert.throws(() => ProtocolVersion.of("v1"), DomainError);
  assert.throws(() => CatalogFingerprint.of("x"), DomainError);
  assert.throws(() => RefusalCode.of(""), DomainError);
  assert.ok(ToolName.of("kmp_ask").hasPrefix("kmp_"));
  assert.ok(ServerName.of("made").equals(ServerName.MADE));
  assert.equal(ProtocolVersion.MCP_2024_11_05.value, "2024-11-05");
});

test("JsonSchema canónico independiente del orden de claves", () => {
  assert.equal(JsonSchema.of({ b: 1, a: { d: 2, c: [1, { f: 0, e: 1 }] } }).canonical(), JsonSchema.of({ a: { c: [1, { e: 1, f: 0 }], d: 2 }, b: 1 }).canonical());
});

test("ToolCatalog: huella estable y sensible a esquemas; rechaza duplicados", () => {
  const a = ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_b", { type: "object", properties: { y: {}, x: {} } }), tool("kmp_a")]);
  const b = ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_a"), tool("kmp_b", { properties: { x: {}, y: {} }, type: "object" })]);
  const c = ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_a", { type: "object", required: ["q"] }), tool("kmp_b")]);
  assert.ok(a.fingerprint().equals(b.fingerprint()));
  assert.ok(!a.fingerprint().equals(c.fingerprint()));
  assert.ok(a.has(ToolName.of("kmp_a")));
  assert.deepEqual(a.names().map(String), ["kmp_a", "kmp_b"]);
  assert.throws(() => ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_a"), tool("kmp_a")]), /duplicate/);
});

test("resultados", () => {
  const r = ToolRefusal.of(RefusalCode.of("conflict"), "stale", false);
  assert.equal(r.describe(), "conflict: stale");
  assert.equal(ToolSuccess.of({ a: 1 }, "t").text, "t");
  assert.equal(ToolSuccess.of(null, "t").isSuccess(), true);
  assert.equal(r.isSuccess(), false);
});
