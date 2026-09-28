import { test } from "node:test";
import assert from "node:assert/strict";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const t = (xs: string[]) => xs.map((x) => ToolName.of(x));

test("interactivo: KMP de lectura y escritura explícita; nunca control de MADE; conserva ajenas", () => {
  const out = PhaseToolSelection.standard().select(Phase.INTERACTIVE, t(["kmp_ask", "kmp_ingest", "made_claim_ceremony_step", "made_design_ceremony"]), ["read", "bash"]);
  assert.deepEqual(out.sort(), ["bash", "kmp_ask", "read"]);
});

test("diseño añade la autoría de MADE", () => {
  const out = PhaseToolSelection.standard().select(Phase.DESIGN, t(["kmp_ask", "made_design_ceremony", "made_claim_ceremony_step"]), []);
  assert.deepEqual(out.sort(), ["kmp_ask", "made_design_ceremony"]);
});

test("Phase valida", () => {
  assert.ok(Phase.of("design").equals(Phase.DESIGN));
  assert.throws(() => Phase.of("run"), DomainError);
});
