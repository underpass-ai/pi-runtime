import type { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";

export interface MadeConfigurationRepository {
  load(store: StorePath): MadeConfiguration | null;
  create(store: StorePath, configuration: MadeConfiguration): void;
  locationOf(store: StorePath): string;
}
