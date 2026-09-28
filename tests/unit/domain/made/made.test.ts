import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityGroupId } from "../../../../src/domain/made/CapabilityGroupId.ts";
import { DeclaredLimitId } from "../../../../src/domain/made/DeclaredLimitId.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("CapabilityGroupId.of rechaza un id no-string", () => {
  assert.throws(() => CapabilityGroupId.of(undefined as never), DomainError);
});

test("DeclaredLimitId.of rechaza un id no-string", () => {
  assert.throws(() => DeclaredLimitId.of(undefined as never), DomainError);
});
