import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { ToolName } from "./ToolName.ts";

export class ServerName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly KMP = new ServerName("kmp");
  static readonly MADE = new ServerName("made");
  static of(raw: string): ServerName {
    if (raw === "kmp") return ServerName.KMP;
    if (raw === "made") return ServerName.MADE;
    throw DomainError.because(`unknown server ${raw}`);
  }
  // El servidor dueño de una tool por su prefijo (kmp_, made_); null para las de Pi.
  static owning(tool: ToolName): ServerName | null {
    return tool.hasPrefix("kmp_") ? ServerName.KMP : tool.hasPrefix("made_") ? ServerName.MADE : null;
  }
}
