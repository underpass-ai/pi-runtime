import type { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";

export interface AuthorizationBootstrapper { bootstrap(store: StorePath, config: MadeConfiguration): Promise<string>; }
