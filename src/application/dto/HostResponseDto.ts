import type { ConfirmationRequestDto } from "./ConfirmationRequestDto.ts";

export type HostResponseDto =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { kind: "refused" | "rpc" | "transport" | "denied" | "invalid"; message: string; code?: string | number; confirmation?: ConfirmationRequestDto } };
