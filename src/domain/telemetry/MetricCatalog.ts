import { MetricDescriptor } from "./MetricDescriptor.ts";

// Las métricas de la spec (§2). Es la única fuente: la proyección, el texto
// Prometheus, el mapeo OTLP y el test de los artefactos leen de aquí.
export class MetricCatalog {
  private constructor() {}
  static readonly TOOL_INVOCATIONS = MetricDescriptor.counter("pi_runtime_tool_invocations_total", "Tool invocations by final status.", ["tool", "server", "status"]);
  static readonly TOOL_REFUSED = MetricDescriptor.counter("pi_runtime_tool_refused_total", "Refused tool invocations by bounded reason.", ["tool", "reason"]);
  static readonly TOOL_DURATION = MetricDescriptor.histogram("pi_runtime_tool_duration_ms", "Tool invocation duration in milliseconds.", ["tool", "server"]);
  static readonly TURNS = MetricDescriptor.counter("pi_runtime_turns_total", "Completed model turns.", ["model", "provider", "outcome"]);
  static readonly TOKENS = MetricDescriptor.counter("pi_runtime_tokens_total", "Model tokens by kind.", ["model", "provider", "kind"]);
  static readonly COST = MetricDescriptor.counter("pi_runtime_cost_total", "Model cost in the unit reported by Pi.", ["model", "provider"], false);
  static readonly SESSIONS = MetricDescriptor.counter("pi_runtime_sessions_total", "Session lifecycle events.", ["event"]);
  static readonly COMPACTIONS = MetricDescriptor.counter("pi_runtime_compactions_total", "Context compactions.", ["reason"]);
  static readonly SERVER_STARTS = MetricDescriptor.counter("pi_runtime_server_starts_total", "MCP server starts.", ["server"]);
  static readonly SERVER_EXITS = MetricDescriptor.counter("pi_runtime_server_exits_total", "MCP server exits by exit code.", ["server", "code"]);

  static readonly ALL: readonly MetricDescriptor[] = [
    MetricCatalog.TOOL_INVOCATIONS, MetricCatalog.TOOL_REFUSED, MetricCatalog.TOOL_DURATION, MetricCatalog.TURNS, MetricCatalog.TOKENS,
    MetricCatalog.COST, MetricCatalog.SESSIONS, MetricCatalog.COMPACTIONS, MetricCatalog.SERVER_STARTS, MetricCatalog.SERVER_EXITS,
  ];

  static find(name: string): MetricDescriptor | null { return MetricCatalog.ALL.find((d) => d.name === name) ?? null; }
}
