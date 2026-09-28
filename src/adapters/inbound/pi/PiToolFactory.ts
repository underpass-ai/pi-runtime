import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { ToolCallResultDto } from "../../../application/dto/ToolCallResultDto.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolDescriptor } from "../../../domain/mcp/ToolDescriptor.ts";
import { HostCallError } from "../../outbound/ipc/HostCallError.ts";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.charCodeAt(max - 1) >= 0xd800 && text.charCodeAt(max - 1) <= 0xdbff ? max - 1 : max;
  return `${text.slice(0, cut)}\n[truncated ${text.length - cut} chars; full result in details]`;
}

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
      async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal) {
        if (signal?.aborted) throw new Error(`${tool.name} aborted; outcome unknown`);
        let onAbort: (() => void) | undefined;
        try {
          const r = await new Promise<ToolCallResultDto>((resolve, reject) => {
            (async () => {
              try { resolve(await (await gateway()).call(server, tool.name, params)); }
              catch (e) { reject(e); }
            })();
            if (signal) {
              onAbort = () => reject(new Error(`${tool.name} aborted; outcome unknown`));
              signal.addEventListener("abort", onAbort, { once: true });
            }
          });
          const text = truncate(r.text, max);
          return { content: [{ type: "text" as const, text }], details: r.structured };
        } catch (e) {
          if (e instanceof HostCallError) throw new Error(`${tool.name} ${e.kind} (${e.code ?? "-"}): ${e.message}`);
          throw e;
        } finally {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        }
      },
    };
  }
}
