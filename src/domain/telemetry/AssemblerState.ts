import type { SpanJson } from "./SpanJson.ts";

type Attrs = Record<string, string | number | boolean>;
type OpenSpan = { spanId: string; startMs: number; attributes: Attrs };
type OpenTool = { eventId: string; startMs: number; recordedAtMs: number; attributes: Attrs };

// Estado explícito y serializable (JSON) del ensamblador: sesiones y host abiertos, tools
// en curso, spans de tool que esperan a su turno y callIds ya emitidos como incompletos.
// `lastMs`/`lastRecordedAtMs`: el último hecho de la sesión (occurredAt y recordedAt), para
// cerrar las abandonadas; un estado anterior sin ellos cuenta desde el inicio de la sesión.
// Se guarda en projection_state del consumidor `otlp_traces`: un reinicio no pierde spans.
export type AssemblerState = {
  sessions: Record<string, OpenSpan & {
    events: { name: string; atMs: number; attributes: Attrs }[];
    tools: Record<string, OpenTool>;
    pending: { span: SpanJson; recordedAtMs: number }[];
    expired: string[];
    lastMs?: number;
    lastRecordedAtMs?: number;
  }>;
  host: (OpenSpan & { traceId: string; servers: Record<string, OpenSpan> }) | null;
};
