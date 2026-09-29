import type { Clock } from "../../src/application/ports/Clock.ts";
import { Timestamp } from "../../src/domain/events/Timestamp.ts";

export class FixedClock implements Clock {
  ms: number;
  constructor(ms = 10_000) { this.ms = ms; }
  now(): Timestamp { return Timestamp.fromEpochMs(this.ms++); }
}
