import type { SemVer } from "../distribution/SemVer.ts";
import type { CapabilityGroupId } from "./CapabilityGroupId.ts";
import type { DeclaredLimitId } from "./DeclaredLimitId.ts";

type Props = { serverVersion: SemVer; toolCount: number; groups: CapabilityGroupId[]; limits: DeclaredLimitId[]; activationAdapter: string | null };

export class MadeCapabilities {
  readonly serverVersion: SemVer; readonly toolCount: number; readonly groups: readonly CapabilityGroupId[];
  readonly limits: readonly DeclaredLimitId[]; readonly activationAdapter: string | null;
  private constructor(p: Props) { this.serverVersion = p.serverVersion; this.toolCount = p.toolCount; this.groups = p.groups; this.limits = p.limits; this.activationAdapter = p.activationAdapter; }
  static of(p: Props): MadeCapabilities { return new MadeCapabilities(p); }
  declares(limit: DeclaredLimitId): boolean { return this.limits.some((l) => l.equals(limit)); }
}
