// Estado del exportador OTLP para /underpass-status: lag en eventos del log sin exportar; since, desde cuándo falla.
export type ExporterStatusDto = { state: "disabled" | "ok" | "failing"; lag: number; since: string | null };
