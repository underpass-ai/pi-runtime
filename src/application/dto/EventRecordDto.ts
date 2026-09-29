export type EventRecordDto = {
  eventId: string;
  stream: string;
  version: number;
  type: string;
  typeVersion: number;
  occurredAt: string;
  recordedAt: string;
  actor: { kind: string; id: string };
  correlationId: string;
  causationId: string | null;
  payload: unknown;
  prevHash: string | null;
  hash: string;
};
