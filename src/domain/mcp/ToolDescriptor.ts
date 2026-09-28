import type { JsonSchema } from "./JsonSchema.ts";
import type { ToolDescription } from "./ToolDescription.ts";
import type { ToolName } from "./ToolName.ts";

export class ToolDescriptor {
  readonly name: ToolName; readonly description: ToolDescription; readonly schema: JsonSchema;
  private constructor(n: ToolName, d: ToolDescription, s: JsonSchema) { this.name = n; this.description = d; this.schema = s; }
  static of(name: ToolName, description: ToolDescription, schema: JsonSchema): ToolDescriptor { return new ToolDescriptor(name, description, schema); }
}
