import type { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { HostResponseDto } from "../dto/HostResponseDto.ts";

export class HostResponseMapper {
  success(id: number, result: unknown): HostResponseDto { return { id, ok: true, result }; }
  refusal(id: number, r: ToolRefusal): HostResponseDto { return { id, ok: false, error: { kind: "refused", code: r.code.value, message: r.message } }; }
  invalid(id: number, message: string): HostResponseDto { return { id, ok: false, error: { kind: "invalid", message } }; }
  failure(id: number, error: unknown): HostResponseDto {
    const e = error as { code?: unknown; message?: string };
    return typeof e?.code === "number"
      ? { id, ok: false, error: { kind: "rpc", code: e.code, message: e.message ?? "rpc error" } }
      : { id, ok: false, error: { kind: "transport", message: e?.message ?? String(error) } };
  }
}
