export class McpTransportError extends Error {
  constructor(message: string) { super(message); this.name = "McpTransportError"; }
}
