import { Appended } from "../../domain/events/Appended.ts";
import type { Fact } from "../../domain/events/Fact.ts";
import { SessionAggregate } from "../../domain/events/SessionAggregate.ts";
import type { SessionState } from "../../domain/events/SessionState.ts";
import type { StreamId } from "../../domain/events/StreamId.ts";
import { StreamVersion } from "../../domain/events/StreamVersion.ts";
import { DomainError } from "../../domain/shared/DomainError.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";

const ATTEMPTS = 3;

export class RecordFact {
  readonly #store: EventStore; readonly #clock: Clock; readonly #afterAppend: () => void;
  readonly #cache = new Map<string, { version: StreamVersion; state: SessionState }>();

  constructor(store: EventStore, clock: Clock, afterAppend: () => void = () => {}) { this.#store = store; this.#clock = clock; this.#afterAppend = afterAppend; }

  execute(fact: Fact): Appended {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const existing = this.#store.find(fact.stream, fact.id);
      if (existing !== null) {
        if (!existing.matches(fact)) throw DomainError.because(`event ${fact.id.value} already recorded with different content`);
        return Appended.idempotentOf([existing]);
      }
      const expected = this.#store.head(fact.stream)?.version ?? StreamVersion.NONE;
      const state = fact.stream.isSession() ? this.#state(fact.stream, expected) : null;
      const decided = state === null ? fact : SessionAggregate.decide(state, fact);
      const outcome = this.#store.append(fact.stream, expected, [decided], this.#clock.now());
      if (outcome instanceof Appended) {
        if (state !== null) {
          const last = outcome.records.at(-1)!;
          this.#cache.set(fact.stream.value, { version: last.version, state: outcome.records.reduce((s, r) => SessionAggregate.apply(s, r), state) });
        }
        this.#afterAppend();
        return outcome;
      }
      if (outcome.reason === "diverged") throw DomainError.because(`event ${fact.id.value} diverges from the recorded one`);
    }
    throw new Error(`could not record ${fact.id.value} after ${ATTEMPTS} attempts: concurrent writers`);
  }

  #state(stream: StreamId, version: StreamVersion): SessionState {
    const cached = this.#cache.get(stream.value);
    if (cached !== undefined && cached.version.equals(version)) return cached.state;
    const state = SessionAggregate.fold(this.#store.readStream(stream));
    this.#cache.set(stream.value, { version, state });
    return state;
  }
}
