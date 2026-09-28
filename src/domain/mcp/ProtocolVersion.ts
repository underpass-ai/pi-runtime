import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ProtocolVersion extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly MCP_2024_11_05 = new ProtocolVersion("2024-11-05");
  static of(raw: string): ProtocolVersion {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw DomainError.because(`invalid MCP protocol version ${raw}`);
    return new ProtocolVersion(raw);
  }
}
