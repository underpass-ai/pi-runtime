export type OwnerLockAcquisition = { owned: true; release(): void } | { owned: false; ownerPid: number };
