export class McpRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) { super(message); this.name = "McpRpcError"; this.code = code; }
}
