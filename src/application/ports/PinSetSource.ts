import type { PinSet } from "../../domain/distribution/PinSet.ts";

export interface PinSetSource { load(): PinSet; }
