import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolDescriptor } from "../../../domain/mcp/ToolDescriptor.ts";
import { HostCallError } from "../../outbound/ipc/HostCallError.ts";

export class PiToolFactory {
  readonly #toSchema: (json: Record<string, unknown>) => unknown; readonly #maxText: number;
  constructor(toSchema: (json: Record<string, unknown>) => unknown, maxText = 16_000) { this.#toSchema = toSchema; this.#maxText = maxText; }

  create(server: ServerName, tool: ToolDescriptor, gateway: () => Promise<HostGateway>) {
    const max = this.#maxText;
    return {
      name: tool.name.value,
      label: tool.name.value,
      description: tool.description.value,
      parameters: this.#toSchema(tool.schema.toJson()),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const r = await (await gateway()).call(server, tool.name, params);
          const text = r.text.length > max ? `${r.text.slice(0, max)}\n[truncated ${r.text.length - max} chars; full result in details]` : r.text;
          return { content: [{ type: "text" as const, text }], details: r.structured };
        } catch (e) {
          if (e instanceof HostCallError) throw new Error(`${tool.name} ${e.kind} (${e.code ?? "-"}): ${e.message}`);
          throw e;
        }
      },
    };
  }
}
