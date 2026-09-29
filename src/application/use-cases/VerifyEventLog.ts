import type { StreamId } from "../../domain/events/StreamId.ts";
import { StreamVerifier } from "../../domain/events/StreamVerifier.ts";
import type { VerificationResult } from "../../domain/events/VerificationResult.ts";
import type { EventStore } from "../ports/EventStore.ts";

export class VerifyEventLog {
  readonly #store: EventStore;
  constructor(store: EventStore) { this.#store = store; }
  execute(stream?: StreamId): { stream: StreamId; result: VerificationResult }[] {
    return (stream === undefined ? this.#store.streams() : [stream]).map((s) => ({ stream: s, result: StreamVerifier.verify(this.#store.readStream(s)) }));
  }
}
