import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import type { EventRecordDto } from "../dto/EventRecordDto.ts";
import { EventRecordMapper } from "../mappers/EventRecordMapper.ts";
import type { EventStore } from "../ports/EventStore.ts";

export class ShowSession {
  readonly #store: EventStore;
  constructor(store: EventStore) { this.#store = store; }
  execute(id: SessionId): EventRecordDto[] { const m = new EventRecordMapper(); return this.#store.readStream(StreamId.session(id)).map((r) => m.toDto(r)); }
}
