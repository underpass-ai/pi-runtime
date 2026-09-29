import type { CheckDetail } from "./CheckDetail.ts";
import type { CheckName } from "./CheckName.ts";
import type { CheckSection } from "./CheckSection.ts";
import { CheckStatus } from "./CheckStatus.ts";

export class Check {
  readonly section: CheckSection; readonly status: CheckStatus; readonly name: CheckName; readonly detail: CheckDetail;
  private constructor(s: CheckSection, st: CheckStatus, n: CheckName, d: CheckDetail) { this.section = s; this.status = st; this.name = n; this.detail = d; }
  static ok(s: CheckSection, n: CheckName, d: CheckDetail): Check { return new Check(s, CheckStatus.OK, n, d); }
  static warn(s: CheckSection, n: CheckName, d: CheckDetail): Check { return new Check(s, CheckStatus.WARN, n, d); }
  static fail(s: CheckSection, n: CheckName, d: CheckDetail): Check { return new Check(s, CheckStatus.FAIL, n, d); }
}
