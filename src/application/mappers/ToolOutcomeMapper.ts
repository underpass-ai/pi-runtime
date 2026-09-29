import { RefusalCode } from "../../domain/mcp/RefusalCode.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../domain/mcp/ToolSuccess.ts";
import type { McpToolResultDto } from "../dto/McpToolResultDto.ts";
import type { ToolCallResultDto } from "../dto/ToolCallResultDto.ts";

export class ToolOutcomeMapper {
  toDomain(dto: McpToolResultDto): ToolOutcome {
    const text = (dto.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const s = dto.structuredContent;
    if (dto.isError !== true) return ToolSuccess.of(s, text);
    const kmp = s?.error as { code?: string; message?: string } | undefined; // KMP
    const rawCode = kmp?.code ?? (s?.code as string | undefined);          // MADE
    const code = RefusalCode.orUnknown(rawCode);
    return ToolRefusal.of(code, kmp?.message ?? (s?.message as string | undefined) ?? text, s?.retryable === true);
  }
  toDto(success: ToolSuccess): ToolCallResultDto { return { structured: success.structured, text: success.text }; }
}
