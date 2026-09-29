import { DomainError } from "../shared/DomainError.ts";
import { Phase } from "../session/Phase.ts";
import { TelemetryInstanceId } from "../telemetry/TelemetryInstanceId.ts";

// Contexto del bandit (spec §1): el par (fase, proyecto), con el proyecto como id HMAC de O1.
// `key` es la clave de estado de las proyecciones: `<fase>|<proyecto>`.
export class LearningContext {
  readonly phase: Phase; readonly project: TelemetryInstanceId;
  private constructor(phase: Phase, project: TelemetryInstanceId) { this.phase = phase; this.project = project; }

  static of(phase: Phase, project: TelemetryInstanceId): LearningContext { return new LearningContext(phase, project); }

  // Desde el payload de tools.selected: `{phase, project}`.
  static parse(raw: unknown): LearningContext {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw DomainError.because("learning context must be an object");
    const r = raw as Record<string, unknown>;
    return new LearningContext(Phase.of(r.phase as string), TelemetryInstanceId.of(r.project as string));
  }

  get key(): string { return `${this.phase.value}|${this.project.value}`; }
  toJson(): { phase: string; project: string } { return { phase: this.phase.value, project: this.project.value }; }
  equals(o: LearningContext): boolean { return o.key === this.key; }
}
