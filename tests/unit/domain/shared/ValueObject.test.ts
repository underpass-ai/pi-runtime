import { test } from "node:test";
import assert from "node:assert/strict";
import { ValueObject } from "../../../../src/domain/shared/ValueObject.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

class Probe extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(v: string): Probe { return new Probe(v); }
}

test("igualdad por valor y toString", () => {
  assert.ok(Probe.of("a").equals(Probe.of("a")));
  assert.ok(!Probe.of("a").equals(Probe.of("b")));
  assert.equal(String(Probe.of("a")), "a");
});

test("DomainError.because", () => {
  const e = DomainError.because("bad");
  assert.ok(e instanceof DomainError);
  assert.equal(e.message, "bad");
});
