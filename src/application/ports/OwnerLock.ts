import type { OwnerLockAcquisition } from "./OwnerLockAcquisition.ts";

export interface OwnerLock { acquire(): OwnerLockAcquisition; }
