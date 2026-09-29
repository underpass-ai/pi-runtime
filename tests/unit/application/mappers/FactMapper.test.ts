import { test } from "node:test";
import assert from "node:assert/strict";
import { FactMapper } from "../../../../src/application/mappers/FactMapper.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const dto = { stream: "session" as const, sessionId: "s1", type: "tool.started", typeVersion: 1, about: "tool.c1.started", occurredAtMs: 1000, actor: { kind: "agent", id: "pi:1" }, payload: { tool: "kmp_ask" } };

test("mapea un DTO válido con id derivado", () => {
  const f = new FactMapper().toDomain(dto);
  assert.equal(f.id.value, "session:s1:tool.started:tool.c1.started");
  assert.equal(f.payload.text, '{"tool":"kmp_ask"}');
  assert.equal(new FactMapper().toDomain({ ...dto, stream: "host", sessionId: undefined, type: "host.started", about: "h" }).stream.value, "host");
});

test("rechaza streams, payloads y campos inválidos", () => {
  const m = new FactMapper();
  for (const bad of [null, { ...dto, stream: "x" }, { ...dto, sessionId: undefined }, { ...dto, payload: [1] }, { ...dto, payload: "x" }, { ...dto, occurredAtMs: -1 }, { ...dto, actor: undefined }]) {
    assert.throws(() => m.toDomain(bad as never), DomainError);
  }
});
