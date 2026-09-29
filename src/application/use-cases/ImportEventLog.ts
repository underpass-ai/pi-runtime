import { BundleDigest } from "../../domain/events/BundleDigest.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import { DomainError } from "../../domain/shared/DomainError.ts";
import type { EventRecordDto } from "../dto/EventRecordDto.ts";
import { EventRecordMapper } from "../mappers/EventRecordMapper.ts";
import type { EventStore } from "../ports/EventStore.ts";

export class ImportEventLog {
  readonly #store: EventStore;
  constructor(store: EventStore) { this.#store = store; }
  execute(lines: string[]): number {
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) throw DomainError.because("bundle has no header");
    const header = CanonicalJson.parse(nonEmpty[0]).toValue() as Record<string, unknown>;
    if (header.format !== "pi-runtime.events.v1") throw DomainError.because(`unsupported bundle format ${String(header.format)}`);
    const body = nonEmpty.slice(1);
    if (header.count !== body.length || header.sha256 !== BundleDigest.of(body)) throw DomainError.because("bundle sha256/count mismatch");
    const mapper = new EventRecordMapper();
    return this.#store.importSealed(body.map((l) => mapper.toDomain(CanonicalJson.parse(l).toValue() as EventRecordDto)));
  }
}
