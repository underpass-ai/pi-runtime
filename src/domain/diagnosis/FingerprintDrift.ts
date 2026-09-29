import type { CatalogFingerprint } from "../mcp/CatalogFingerprint.ts";
import { Check } from "./Check.ts";
import { CheckDetail } from "./CheckDetail.ts";
import { CheckName } from "./CheckName.ts";
import { CheckSection } from "./CheckSection.ts";

export class FingerprintDrift {
  private constructor() {}
  static compare(previous: Map<string, CatalogFingerprint>, current: Map<string, CatalogFingerprint>): Check[] {
    const name = CheckName.of("catalog fingerprint");
    return [...current.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([server, fp]) => {
      const section = CheckSection.of(server);
      const before = previous.get(server);
      if (!before) return Check.ok(section, name, CheckDetail.of(`recorded ${fp.short()}`));
      if (before.equals(fp)) return Check.ok(section, name, CheckDetail.of(`unchanged ${fp.short()}`));
      return Check.warn(section, name, CheckDetail.of(`changed ${before.short()} → ${fp.short()}; review profiles before trusting new tools`));
    });
  }
}
