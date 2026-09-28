import { ValueObject } from "../shared/ValueObject.ts";

export class CheckStatus extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly OK = new CheckStatus("OK");
  static readonly WARN = new CheckStatus("WARN");
  static readonly FAIL = new CheckStatus("FAIL");
}
