import type { SemVer } from "../../domain/distribution/SemVer.ts";

export interface PiRuntimeInspector { version(): Promise<SemVer | null>; }
