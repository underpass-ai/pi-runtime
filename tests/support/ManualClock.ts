import type { Clock } from "../../src/application/ports/Clock.ts";
import { Timestamp } from "../../src/domain/events/Timestamp.ts";

// Reloj que sólo avanza cuando el test cambia `ms`.
export class ManualClock implements Clock {
  ms: number;
  constructor(ms = 0) { this.ms = ms; }
  now(): Timestamp { return Timestamp.fromEpochMs(this.ms); }
}
