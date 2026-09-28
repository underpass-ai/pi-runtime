import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolOutcomeMapper } from "../../../../src/application/mappers/ToolOutcomeMapper.ts";
import { McpToolMapper } from "../../../../src/application/mappers/McpToolMapper.ts";
import { CatalogMapper } from "../../../../src/application/mappers/CatalogMapper.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";

const outcomes = new ToolOutcomeMapper();

test("éxito y resultado de app sin isError", () => {
  const ok = outcomes.toDomain({ content: [{ type: "text", text: "hi" }], structuredContent: { a: 1 }, isError: false });
  assert.ok(ok instanceof ToolSuccess);
  assert.deepEqual(outcomes.toDto(ok as ToolSuccess), { structured: { a: 1 }, text: "hi" });
  assert.ok(outcomes.toDomain({ content: [], structuredContent: { v: 1 } }) instanceof ToolSuccess);
});

test("negativa KMP, negativa MADE e isError sin estructura", () => {
  const kmp = outcomes.toDomain({ content: [{ type: "text", text: "t" }], structuredContent: { error: { code: "conflict", message: "stale" } }, isError: true }) as ToolRefusal;
  assert.deepEqual([kmp.code.value, kmp.message, kmp.retryable], ["conflict", "stale", false]);
  const made = outcomes.toDomain({ content: [], structuredContent: { code: "unavailable", message: "busy", retryable: true }, isError: true }) as ToolRefusal;
  assert.deepEqual([made.code.value, made.retryable], ["unavailable", true]);
  const bare = outcomes.toDomain({ content: [{ type: "text", text: "boom" }], isError: true }) as ToolRefusal;
  assert.deepEqual([bare.code.value, bare.message], ["unknown", "boom"]);
});

test("catálogo ida y vuelta conserva la huella", () => {
  const tools = [{ name: "kmp_ask", description: "Ask", inputSchema: { type: "object" } }, { name: "kmp_wake", inputSchema: { type: "object" } }].map((d) => new McpToolMapper().toDomain(d));
  const cat = ToolCatalog.of(ServerName.KMP, ServerIdentity.of("underpass-kmp-mcp", SemVer.of("0.24.0")), tools);
  const dto = new CatalogMapper().toDto(cat);
  assert.equal(dto.tools[1].description, "kmp_wake");
  assert.ok(new CatalogMapper().toDomain(dto).fingerprint().equals(cat.fingerprint()));
  assert.equal(dto.fingerprint, cat.fingerprint().value);
});
