import type { SessionId } from "../events/SessionId.ts";
import type { Phase } from "../session/Phase.ts";
import type { ConfirmationToken } from "./ConfirmationToken.ts";

// Lo que la extensión dice de una llamada a MADE (S3a §2): de qué sesión es, en qué fase está
// Pi (null si no lo sabe) y, si el usuario ya aceptó, el token de su confirmación.
export class MadeCallContext {
  readonly session: SessionId; readonly phase: Phase | null; readonly token: ConfirmationToken | null;
  private constructor(session: SessionId, phase: Phase | null, token: ConfirmationToken | null) { this.session = session; this.phase = phase; this.token = token; }
  static of(session: SessionId, phase: Phase | null, token: ConfirmationToken | null = null): MadeCallContext { return new MadeCallContext(session, phase, token); }
}
