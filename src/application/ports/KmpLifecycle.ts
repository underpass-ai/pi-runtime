export interface KmpLifecycle { setup(): Promise<void>; doctor(): Promise<boolean>; }
