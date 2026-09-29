import type { Clock } from "../../../application/ports/Clock.ts";
import { Timestamp } from "../../../domain/events/Timestamp.ts";

export class SystemClock implements Clock {
  now(): Timestamp { return Timestamp.fromEpochMs(Date.now()); }
}
