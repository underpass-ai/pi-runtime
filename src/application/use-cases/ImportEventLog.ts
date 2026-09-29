import { BundleDigest } from "../../domain/events/BundleDigest.ts";
import type { ProjectId } from "../../domain/project/ProjectId.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import { DomainError } from "../../domain/shared/DomainError.ts";
import type { EventRecordDto } from "../dto/EventRecordDto.ts";
import { EventRecordMapper } from "../mappers/EventRecordMapper.ts";
import type { EventStore } from "../ports/EventStore.ts";

// Un bundle de otro proyecto no se rechaza (mover un log entre clones o
// rutas es legítimo), pero se avisa: el project_id de la cabecera no cuadra.
export class ImportEventLog {
  readonly #store: EventStore; readonly #target: ProjectId;
  constructor(store: EventStore, target: ProjectId) { this.#store = store; this.#target = target; }
  execute(lines: string[]): { imported: number; warnings: string[] } {
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) throw DomainError.because("bundle has no header");
    const header = CanonicalJson.parse(nonEmpty[0]).toValue() as Record<string, unknown>;
    if (header.format !== "pi-runtime.events.v1") throw DomainError.because(`unsupported bundle format ${String(header.format)}`);
    const body = nonEmpty.slice(1);
    if (header.count !== body.length || header.sha256 !== BundleDigest.of(body)) throw DomainError.because("bundle sha256/count mismatch");
    const warnings = header.project_id === this.#target.value ? [] : [`bundle project_id ${String(header.project_id)} differs from this project (${this.#target.value})`];
    const mapper = new EventRecordMapper();
    return { imported: this.#store.importSealed(body.map((l) => mapper.toDomain(CanonicalJson.parse(l).toValue() as EventRecordDto))), warnings };
  }
}
