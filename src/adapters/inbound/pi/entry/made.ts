import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ExtensionComposition } from "../../../../composition/ExtensionComposition.ts";
import { ServerName } from "../../../../domain/mcp/ServerName.ts";

export default (pi: ExtensionAPI) => ExtensionComposition.server(pi as never, ServerName.MADE, (json) => Type.Unsafe(json));
