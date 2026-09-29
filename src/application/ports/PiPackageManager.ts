export interface PiPackageManager { install(packageDir: string): Promise<void>; isRegistered(packageName: string): Promise<boolean>; }
