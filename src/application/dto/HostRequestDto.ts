import type { FactDto } from "./FactDto.ts";

export type HostRequestDto =
  | { id: number; method: "call"; server: string; tool: string; args: Record<string, unknown> }
  | { id: number; method: "catalog"; server: string }
  | { id: number; method: "health" }
  | { id: number; method: "record"; fact: FactDto }
  | { id: number; method: "summary"; sessionId: string }
  | { id: number; method: "select"; sessionId: string; phase: string };
