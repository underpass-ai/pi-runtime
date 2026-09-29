// Forma JSON de un span, para el estado persistido del ensamblador.
export type SpanJson = {
  traceId: string;
  spanId: string;
  parentId: string | null;
  name: string;
  startMs: number;
  endMs: number;
  status: string;
  attributes: Record<string, string | number | boolean>;
  events: { name: string; atMs: number; attributes: Record<string, string | number | boolean> }[];
};
