import type { Timestamp } from "../../domain/events/Timestamp.ts";

export interface Clock { now(): Timestamp; }
