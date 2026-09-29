import { BundleDigest } from "../../domain/events/BundleDigest.ts";
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { ProjectId } from "../../domain/project/ProjectId.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import { EventRecordMapper } from "../mappers/EventRecordMapper.ts";
import type { EventStore } from "../ports/EventStore.ts";

export class ExportEventLog {
  readonly #store: EventStore; readonly #project: ProjectId;
  constructor(store: EventStore, project: ProjectId) { this.#store = store; this.#project = project; }
  execute(since: GlobalPosition = GlobalPosition.START): string[] {
    const mapper = new EventRecordMapper(); const body: string[] = [];
    let from: number | null = null; let to: number | null = null; let after = since;
    for (;;) {
      const batch = this.#store.readAll(after, 1000);
      if (batch.length === 0) break;
      for (const e of batch) { body.push(CanonicalJson.of(mapper.toDto(e.record)).text); from ??= e.position.value; to = e.position.value; }
      after = batch[batch.length - 1].position;
    }
    const header = CanonicalJson.of({ format: "pi-runtime.events.v1", project_id: this.#project.value, from, to, count: body.length, sha256: BundleDigest.of(body) }).text;
    return [header, ...body];
  }
}
