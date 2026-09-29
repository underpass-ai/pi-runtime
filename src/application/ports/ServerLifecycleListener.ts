import type { ServerIdentity } from "../../domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";

export interface ServerLifecycleListener { started(server: ServerName, identity: ServerIdentity): void; exited(server: ServerName): void; }
