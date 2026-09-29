export type FactDto = {
  stream: "host" | "session"; sessionId?: string; type: string; typeVersion: number; about: string;
  occurredAtMs: number; actor: { kind: string; id: string }; payload: Record<string, unknown>;
};
