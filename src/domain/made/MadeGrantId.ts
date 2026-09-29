import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { SessionId } from "../events/SessionId.ts";
import type { Timestamp } from "../events/Timestamp.ts";
import type { MadeAction } from "./MadeAction.ts";
import type { MadeScope } from "./MadeScope.ts";
import { GrantSequence } from "./GrantSequence.ts";

const PREFIX = "pi-runtime-";

// Id de un grant emitido por el host. Determinista (S3a §2.4): sesión, acción, alcance e
// instante; reemitir el mismo grant con el mismo id es un no-op en MADE.
export class MadeGrantId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): MadeGrantId {
    if (typeof raw !== "string" || !/^pi-runtime-[0-9a-f]{32}$/.test(raw)) throw DomainError.because(`invalid host grant id ${raw}`);
    return new MadeGrantId(raw);
  }
  // La secuencia sólo entra a partir del segundo grant igual: el primero conserva el id de S3a.
  static derive(session: SessionId, action: MadeAction, scope: MadeScope, from: Timestamp, sequence: GrantSequence = GrantSequence.FIRST): MadeGrantId {
    const seq = sequence.equals(GrantSequence.FIRST) ? "" : `\n#${sequence.value}`;
    const digest = createHash("sha256").update(`${session.value}\n${action.value}\n${scope.key}\n${from.value}${seq}`).digest("hex");
    return new MadeGrantId(`${PREFIX}${digest.slice(0, 32)}`);
  }
}
