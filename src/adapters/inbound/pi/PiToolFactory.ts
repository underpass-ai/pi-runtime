import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { CallContextDto } from "../../../application/dto/CallContextDto.ts";
import type { ConfirmationRequestDto } from "../../../application/dto/ConfirmationRequestDto.ts";
import type { ToolCallResultDto } from "../../../application/dto/ToolCallResultDto.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolDescriptor } from "../../../domain/mcp/ToolDescriptor.ts";
import { HostCallError } from "../../../application/ports/HostCallError.ts";

// Lo que Pi 0.87.1 pasa como quinto argumento a execute: sólo lo que S3a usa.
type ToolContext = { hasUI?: boolean; ui?: { confirm(title: string, message: string, opts?: { signal?: AbortSignal }): Promise<boolean> } };

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.charCodeAt(max - 1) >= 0xd800 && text.charCodeAt(max - 1) <= 0xdbff ? max - 1 : max;
  return `${text.slice(0, cut)}\n[truncated ${text.length - cut} chars; full result in details]`;
}

// Espera una respuesta del host, pero un abort de Pi la corta (el resultado queda desconocido).
function abortable<T>(work: () => Promise<T>, signal: AbortSignal | undefined, tool: string): Promise<T> {
  let onAbort: (() => void) | undefined;
  return new Promise<T>((resolve, reject) => {
    // Escucha antes de empezar y mira si ya llegó: addEventListener sobre una señal abortada no dispara.
    if (signal) {
      onAbort = () => reject(new Error(`${tool} aborted; outcome unknown`));
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    work().then(resolve, reject);
  }).finally(() => { if (signal && onAbort) signal.removeEventListener("abort", onAbort); });
}

export class PiToolFactory {
  readonly #toSchema: (json: Record<string, unknown>) => unknown; readonly #maxText: number;
  constructor(toSchema: (json: Record<string, unknown>) => unknown, maxText = 16_000) { this.#toSchema = toSchema; this.#maxText = maxText; }

  // context: sesión y fase de Pi para cada llamada (S3a); sin él, la llamada va como antes.
  create(server: ServerName, tool: ToolDescriptor, gateway: () => Promise<HostGateway>, context: () => CallContextDto | null = () => null) {
    const max = this.#maxText;
    const name = tool.name.value;
    return {
      name,
      label: name,
      description: tool.description.value,
      parameters: this.#toSchema(tool.schema.toJson()),
      async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolContext) {
        if (signal?.aborted) throw new Error(`${name} aborted; outcome unknown`);
        const base = context();
        const send = (confirmation?: string) => abortable(async (): Promise<ToolCallResultDto> => (await gateway()).call(server, tool.name, params,
          base === null ? undefined : confirmation === undefined ? base : { ...base, confirmation }), signal, name);
        try {
          let r: ToolCallResultDto;
          try { r = await send(); }
          catch (e) {
            // S3a §3: MADE pide una persona. Se pregunta una sola vez; si acepta, la llamada se
            // repite con el token y lo que responda el host es la respuesta (nunca otra pregunta).
            const request = base !== null && HostCallError.is(e) && e.code === "needs_confirmation" ? e.confirmation : undefined;
            if (request === undefined) throw e;
            r = await send(await PiToolFactory.#confirm(name, request, base!, gateway, ctx, signal));
          }
          return { content: [{ type: "text" as const, text: truncate(r.text, max) }], details: r.structured };
        } catch (e) {
          if (HostCallError.is(e)) throw new Error(`${name} ${e.kind} (${e.code ?? "-"}): ${e.message}`);
          throw e;
        }
      },
    };
  }

  // El token si el usuario acepta; si rechaza o no hay UI, lo comunica al host (que lo registra)
  // y lanza la negativa correspondiente. El aviso al host nunca impide la negativa.
  static async #confirm(name: string, request: ConfirmationRequestDto, base: CallContextDto, gateway: () => Promise<HostGateway>, ctx: ToolContext | undefined, signal?: AbortSignal): Promise<string> {
    const what = `MADE ${request.action} on ${request.scopeSummary}`;
    const tell = async (outcome: "declined" | "no_ui") => { try { await (await gateway()).confirmation(SessionId.of(base.sessionId), request.token, outcome); } catch { /* sólo auditoría */ } };
    if (ctx?.hasUI !== true || ctx.ui === undefined) {
      await tell("no_ui");
      throw new HostCallError("refused", `${what} needs human confirmation and this Pi session has no UI`, "needs_confirmation_no_ui");
    }
    let accepted = false;
    try { accepted = await ctx.ui.confirm(`MADE: ${request.action}`, `${request.scopeSummary}. Allow this call?`, signal ? { signal } : undefined); } catch { accepted = false; }
    // Pi resuelve el diálogo a false cuando la llamada se aborta: eso no es un rechazo del usuario.
    if (signal?.aborted) throw new Error(`${name} aborted; outcome unknown`);
    if (!accepted) {
      await tell("declined");
      throw new HostCallError("refused", `the user declined ${what}`, "needs_confirmation_declined");
    }
    return request.token;
  }
}
