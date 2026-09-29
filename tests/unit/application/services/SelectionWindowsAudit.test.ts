import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectionState } from "../../../../src/application/services/ProjectionState.ts";
import { SelectionWindows } from "../../../../src/application/services/SelectionWindows.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { StoredEvent } from "../../../../src/domain/events/StoredEvent.ts";
import { ContinuationSealer } from "../../../../src/domain/events/ContinuationSealer.ts";
import { AT, fact } from "../../../support/recordFixtures.ts";

// La auditoría de MADE la registra el host en el acto, mientras los hechos de Pi de la ventana
// anterior aún pueden venir por su cola: no debe cerrar ventanas ni atribuirse a ellas.
test("un hecho de auditoría de MADE ni cierra ni se atribuye a una ventana de L1; uno de Pi sí", () => {
  const records = ContinuationSealer.seal(null, [
    fact("session.opened", "o", {}, undefined, 500),
    fact("tools.selected", "d1", {}, undefined, 1_000),
    fact("tools.selected", "d2", {}, undefined, 2_000),
    fact("made.grant_issued", "grant.x", {}, undefined, 3_000),
    fact("made.confirmation", "confirm.x", {}, undefined, 3_000),
    fact("tool.completed", "t1", {}, undefined, 3_000),
  ], AT);
  const closed: number[] = []; const attributed: string[] = [];
  const windows = new SelectionWindows<{ atMs: number }>("w", (_s, w) => closed.push(w.atMs));
  const state = new ProjectionState(new Map());
  records.forEach((r, i) => {
    const opened = r.type.value === "tools.selected" ? { atMs: r.occurredAt.epochMs() } : null;
    windows.visit(state, StoredEvent.of(GlobalPosition.of(i + 1), r), opened, () => attributed.push(r.type.value));
    if (r.type.value === "made.confirmation") assert.deepEqual(closed, [], "la auditoría no cerró la primera ventana");
  });
  assert.deepEqual(closed, [1_000]);
  assert.deepEqual(attributed, ["tool.completed"]);
});
