import { DomainError } from "../shared/DomainError.ts";
import type { ServerName } from "../mcp/ServerName.ts";
import type { ToolCatalog } from "../mcp/ToolCatalog.ts";
import type { ToolName } from "../mcp/ToolName.ts";
import { ProfileCheck } from "./ProfileCheck.ts";
import type { ProfileId } from "./ProfileId.ts";

export class ToolProfile {
  readonly id: ProfileId; readonly server: ServerName; readonly required: readonly ToolName[];
  private constructor(id: ProfileId, s: ServerName, r: ToolName[]) { this.id = id; this.server = s; this.required = r; }
  static of(id: ProfileId, server: ServerName, required: ToolName[]): ToolProfile { return new ToolProfile(id, server, required); }
  check(catalog: ToolCatalog): ProfileCheck {
    if (!catalog.server.equals(this.server)) throw DomainError.because(`profile ${this.id} cannot be checked against ${catalog.server}`);
    return ProfileCheck.of(this.id, this.required.filter((t) => !catalog.has(t)));
  }
}
