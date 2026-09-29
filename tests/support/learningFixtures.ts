import { InMemoryEventStore } from "../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import type { Projection } from "../../src/application/ports/Projection.ts";
import { ProjectionRunner } from "../../src/application/services/ProjectionRunner.ts";
import type { Fact } from "../../src/domain/events/Fact.ts";
import type { StreamId } from "../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../src/domain/events/Timestamp.ts";
import { SESSION, fact } from "./recordFixtures.ts";

export const PROJECT = "ecf99390f4089f4f";
export const DESIGN = `design|${PROJECT}`;

// tools.selected con valores por defecto: active, sin control, 4 candidatas y 2 seleccionadas.
// ms: occurredAt (las ventanas se atribuyen por occurredAt).
export function selection(about: string, overrides: Record<string, unknown> = {}, stream: StreamId = SESSION, ms = 1_000): Fact {
  return fact("tools.selected", about, {
    context: { phase: "design", project: PROJECT }, mode: "active", control: false, k: 4, candidates: ["kmp_guide", "kmp_time", "kmp_trace", "made_get_help"],
    selected: ["kmp_time", "kmp_guide"], floor: ["kmp_ask", "kmp_wake"], seed: about, schemaBytes: { full: 1000, exposed: 600 }, ...overrides,
  }, stream, ms);
}
export const used = (about: string, tool: string, status: string, stream: StreamId = SESSION, ms = 1_000): Fact =>
  fact("tool.completed", about, { tool, server: tool.startsWith("kmp_") ? "kmp" : tool.startsWith("made_") ? "made" : "pi", callId: about, status }, stream, ms);
export const turn = (about: string, stream: StreamId = SESSION, ms = 1_000): Fact => fact("turn.completed", about, { tokens: { input: 1, output: 1 } }, stream, ms);

// Un log en memoria con proyecciones: cada hecho se añade con su recordedAt (para el abandono)
// y el runner corre tras cada append, como en el host.
export class LearningLog {
  readonly events = new InMemoryEventStore();
  readonly store = new InMemoryProjectionStore();
  readonly runner: ProjectionRunner;
  constructor(projections: Projection[]) { this.runner = new ProjectionRunner(this.events, this.store, projections); }

  // Sólo añade al log, sin correr las proyecciones.
  write(f: Fact, recordedMs = 5_000): this {
    this.events.append(f.stream, this.events.head(f.stream)?.version ?? StreamVersion.NONE, [f], Timestamp.fromEpochMs(recordedMs));
    return this;
  }
  add(f: Fact, recordedMs = 5_000): this { this.write(f, recordedMs); this.runner.runOnce(); return this; }
  addAll(facts: Fact[], recordedMs = 5_000): this { for (const f of facts) this.add(f, recordedMs); return this; }
}
