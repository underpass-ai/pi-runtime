import type { ToolName } from "../mcp/ToolName.ts";
import type { ProfileId } from "./ProfileId.ts";

export class ProfileCheck {
  readonly profile: ProfileId; readonly #missing: ToolName[];
  private constructor(p: ProfileId, m: ToolName[]) { this.profile = p; this.#missing = m; }
  static of(profile: ProfileId, missing: ToolName[]): ProfileCheck { return new ProfileCheck(profile, missing); }
  missing(): ToolName[] { return [...this.#missing]; }
  isSatisfied(): boolean { return this.#missing.length === 0; }
}
