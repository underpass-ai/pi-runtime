import { createHash } from "node:crypto";
import type { SessionId } from "../events/SessionId.ts";
import type { ToolName } from "../mcp/ToolName.ts";
import { CanonicalJson } from "../shared/CanonicalJson.ts";
import { ValueObject } from "../shared/ValueObject.ts";

// Huella de una llamada exacta (sesión, tool y argumentos en JSON canónico): liga un token de
// confirmación a la llamada que lo pidió sin guardar los argumentos.
export class CallDigest extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(session: SessionId, tool: ToolName, args: Record<string, unknown>): CallDigest {
    const text = CanonicalJson.of({ session: session.value, tool: tool.value, args }).text;
    return new CallDigest(createHash("sha256").update(text).digest("hex"));
  }
}
