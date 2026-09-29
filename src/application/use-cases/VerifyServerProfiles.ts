import type { ProfileCheck } from "../../domain/contracts/ProfileCheck.ts";
import type { ToolProfiles } from "../../domain/contracts/ToolProfiles.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";

export class VerifyServerProfiles {
  readonly #profiles: ToolProfiles;
  constructor(profiles: ToolProfiles) { this.#profiles = profiles; }
  execute(catalog: ToolCatalog): ProfileCheck[] { return this.#profiles.forServer(catalog.server).map((p) => p.check(catalog)); }
}
