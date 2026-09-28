export type HostRequestDto =
  | { id: number; method: "call"; server: string; tool: string; args: Record<string, unknown> }
  | { id: number; method: "catalog"; server: string }
  | { id: number; method: "health" };
