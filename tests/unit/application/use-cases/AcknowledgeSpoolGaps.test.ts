import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpoolGapMarkers } from "../../../../src/application/ports/SpoolGapMarkers.ts";
import { AcknowledgeSpoolGaps } from "../../../../src/application/use-cases/AcknowledgeSpoolGaps.ts";

class MemMarkers implements SpoolGapMarkers {
  markers: string[];
  constructor(markers: string[]) { this.markers = markers; }
  list(): string[] { return [...this.markers]; }
  remove(marker: string): void { this.markers = this.markers.filter((m) => m !== marker); }
}

test("reconoce (borra) todos los marcadores de hueco y devuelve cuáles", () => {
  const markers = new MemMarkers(["3.gap", "9.gap"]);
  assert.deepEqual(new AcknowledgeSpoolGaps(markers).execute(), ["3.gap", "9.gap"]);
  assert.deepEqual(markers.markers, []);
});

test("sin huecos no hace nada", () => {
  assert.deepEqual(new AcknowledgeSpoolGaps(new MemMarkers([])).execute(), []);
});
