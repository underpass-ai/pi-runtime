import { JsonSchema } from "../../domain/mcp/JsonSchema.ts";
import { ToolDescription } from "../../domain/mcp/ToolDescription.ts";
import { ToolDescriptor } from "../../domain/mcp/ToolDescriptor.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import type { McpToolDto } from "../dto/McpToolDto.ts";

export class McpToolMapper {
  toDomain(dto: McpToolDto): ToolDescriptor {
    return ToolDescriptor.of(ToolName.of(dto.name), ToolDescription.of(dto.description?.trim() ? dto.description : dto.name), JsonSchema.of(dto.inputSchema ?? { type: "object" }));
  }
  toDto(d: ToolDescriptor): McpToolDto { return { name: d.name.value, description: d.description.value, inputSchema: d.schema.toJson() }; }
}
