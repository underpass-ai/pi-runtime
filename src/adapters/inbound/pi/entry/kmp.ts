import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ExtensionComposition } from "../../../../composition/ExtensionComposition.ts";
import { ServerName } from "../../../../domain/mcp/ServerName.ts";

// F1: el diagnóstico de argumentos sólo sale si el validador real de Pi también los rechaza. Si
// este Pi no lo exporta, o falla por otra cosa que no sea una validación, cuenta como aceptado.
const piAccepts = typeof validateToolArguments !== "function" ? undefined : (tool: { name: string; parameters: unknown }, args: unknown) => {
  try { validateToolArguments(tool as never, { type: "toolCall", id: "f1", name: tool.name, arguments: args } as never); return true; }
  catch (e) { return !(e instanceof Error && e.message.startsWith("Validation failed")); }
};

export default (pi: ExtensionAPI) => ExtensionComposition.server(pi as never, ServerName.KMP, (json) => Type.Unsafe(json), piAccepts);
