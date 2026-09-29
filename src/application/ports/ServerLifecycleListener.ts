import type { ServerIdentity } from "../../domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";

// code: el código de salida del proceso del servidor, null si no se conoce.
export interface ServerLifecycleListener { started(server: ServerName, identity: ServerIdentity): void; exited(server: ServerName, code: number | null): void; }
