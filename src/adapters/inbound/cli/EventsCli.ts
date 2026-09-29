import type { QualityKpisDto } from "../../../application/dto/QualityKpisDto.ts";
import type { SpanRowDto } from "../../../application/dto/SpanRowDto.ts";
import { QualityKpisProjection } from "../../../application/projections/QualityKpisProjection.ts";
import { SessionSummaryProjection } from "../../../application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../../../application/projections/ToolStatsProjection.ts";
import type { AcknowledgeSpoolGaps } from "../../../application/use-cases/AcknowledgeSpoolGaps.ts";
import type { ExportEventLog } from "../../../application/use-cases/ExportEventLog.ts";
import type { ImportEventLog } from "../../../application/use-cases/ImportEventLog.ts";
import type { ListSessions } from "../../../application/use-cases/ListSessions.ts";
import type { ProjectionLag } from "../../../application/use-cases/ProjectionLag.ts";
import type { QualityKpisReport } from "../../../application/use-cases/QualityKpisReport.ts";
import type { ReadTelemetryMetrics } from "../../../application/use-cases/ReadTelemetryMetrics.ts";
import type { RebuildProjection } from "../../../application/use-cases/RebuildProjection.ts";
import type { SessionTrace } from "../../../application/use-cases/SessionTrace.ts";
import type { ShowSession } from "../../../application/use-cases/ShowSession.ts";
import type { ToolStatsReport } from "../../../application/use-cases/ToolStatsReport.ts";
import type { VerifyEventLog } from "../../../application/use-cases/VerifyEventLog.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ProjectionName } from "../../../domain/events/ProjectionName.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import { StreamId } from "../../../domain/events/StreamId.ts";
import { Timestamp } from "../../../domain/events/Timestamp.ts";
import { CanonicalJson } from "../../../domain/shared/CanonicalJson.ts";
import { HistogramValue } from "../../../domain/telemetry/HistogramValue.ts";

type Deps = {
  sessions: ListSessions; show: ShowSession; tools: ToolStatsReport; kpis: QualityKpisReport; trace: SessionTrace; metrics: ReadTelemetryMetrics;
  verify: VerifyEventLog; exportLog: ExportEventLog; importLog: ImportEventLog; rebuild: RebuildProjection; lag: ProjectionLag; ackGaps: AcknowledgeSpoolGaps;
  readFile: (path: string) => string; print: (s: string) => void;
};
const USAGE = "usage: underpass events sessions [--since t]|show <session>|tools|kpis [--session s]|trace <session>|verify [--stream s]|export [--since n]|import <file>|rebuild <projection>|ack-gaps";
const opt = (args: string[], flag: string): string | null => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? "" : null; };
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const bound = (v: number | null) => (v === null ? "-" : v === Number.POSITIVE_INFINITY ? `>${HistogramValue.BOUNDS[HistogramValue.BOUNDS.length - 1]}ms` : `<=${v}ms`);

export class EventsCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  run(args: string[]): number {
    const [cmd, arg] = args; const d = this.#d;
    try {
      switch (cmd) {
        case "sessions": {
          const since = opt(args, "--since");
          let from: Timestamp | undefined;
          if (since !== null) { try { from = Timestamp.parse(since); } catch { return this.#usage(); } }
          const sessions = d.sessions.execute(from);
          const behind = this.#hints(SessionSummaryProjection.NAME);
          if (sessions.length === 0 && !behind) d.print("no sessions recorded yet");
          for (const s of sessions) d.print(`${s.sessionId}  ${s.openedAt ?? "-"}  ${s.phase ?? "-"}  turns=${s.turns}  tokens=${s.tokens.input}+${s.tokens.output}  cost=${s.cost.toFixed(4)}  failures=${s.failures}`);
          return 0;
        }
        case "show": {
          if (!arg) return this.#usage();
          const timeline = d.show.execute(SessionId.of(arg));
          if (timeline.length === 0) d.print(`no events for session ${arg}`);
          for (const r of timeline) d.print(`v${r.version}  ${r.occurredAt}  ${r.type}  ${CanonicalJson.of(r.payload).text}`);
          return 0;
        }
        case "tools": {
          const rows = d.tools.execute();
          const behind = this.#hints(ToolStatsProjection.NAME);
          if (rows.length === 0 && !behind) d.print("no tool calls recorded yet");
          for (const t of rows) d.print(`${t.server}/${t.tool}  n=${t.n}  ok=${t.succeeded}  fail=${t.failed}  refused=${t.refused}  aborted=${t.aborted}  p50=${t.p50 ?? "-"}  p95=${t.p95 ?? "-"}`);
          return 0;
        }
        case "kpis": {
          const s = opt(args, "--session");
          if (s === "" || (s === null && args.length > 1)) return this.#usage();
          const session = s === null ? undefined : SessionId.of(s);
          const k = d.kpis.execute(session);
          this.#hints(QualityKpisProjection.NAME);
          if (k === null) { d.print(`no KPIs for session ${s}`); return 0; }
          this.#kpis(k);
          for (const p of d.metrics.execute(session).points()) {
            if (p.histogram === null) continue;
            d.print(`latency      ${p.key.labels.get("server")}/${p.key.labels.get("tool")} p50${bound(p.histogram.quantile(0.5))} p95${bound(p.histogram.quantile(0.95))}`);
          }
          return 0;
        }
        case "trace": {
          if (!arg) return this.#usage();
          const rows = d.trace.execute(SessionId.of(arg));
          if (rows.length === 0) d.print(`no events for session ${arg}`);
          for (const r of rows) d.print(EventsCli.#span(r));
          return 0;
        }
        case "verify": {
          const s = opt(args, "--stream");
          if (s === "") return this.#usage();
          const results = d.verify.execute(s === null ? undefined : StreamId.of(s));
          if (results.length === 0) d.print("no streams recorded yet");
          for (const x of results) d.print(`${x.stream.value}  ${x.result.kind}${x.result.reason ? ` at v${x.result.version?.value}: ${x.result.reason}` : ""}`);
          // Pedir un stream concreto que no existe es un fallo; el log entero sin streams no lo es.
          return results.some((x) => x.result.kind === "broken" || (s !== null && x.result.kind === "notFound")) ? 1 : 0;
        }
        case "export": {
          const since = opt(args, "--since");
          if (since !== null && !/^\d+$/.test(since)) return this.#usage();
          for (const l of d.exportLog.execute(since === null ? GlobalPosition.START : GlobalPosition.of(Number(since)))) d.print(l);
          return 0;
        }
        case "import": {
          if (!arg) return this.#usage();
          const { imported, warnings } = d.importLog.execute(d.readFile(arg).split("\n"));
          for (const w of warnings) d.print(`warning: ${w}`);
          d.print(`imported ${imported} events`);
          if (imported > 0) this.#hints();
          return 0;
        }
        case "rebuild":
          if (!arg) return this.#usage();
          d.rebuild.execute(ProjectionName.of(arg));
          d.print(`rebuilt ${arg}`);
          return 0;
        case "ack-gaps": {
          const acknowledged = d.ackGaps.execute();
          if (acknowledged.length === 0) d.print("no spool gap markers to acknowledge");
          else { for (const m of acknowledged) d.print(`acknowledged ${m}`); d.print(`acknowledged ${acknowledged.length} spool gap marker(s)`); }
          return 0;
        }
        default:
          return this.#usage();
      }
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }

  #kpis(k: QualityKpisDto): void {
    const p = this.#d.print;
    p(`scope        ${k.scope}`);
    p(`sessions     ${k.sessions}`);
    p(`turns        ${k.turns}`);
    p(`cost         ${k.cost.toFixed(4)}`);
    p(`tokens       input=${k.tokens.input} output=${k.tokens.output} cache_read=${k.tokens.cacheRead} cache_write=${k.tokens.cacheWrite}`);
    p(`first-try    ${pct(k.firstTrySuccess)}`);
    p(`refusals     ${pct(k.refusalRate)} of ${k.invocations} calls`);
    p(`cache ratio  ${pct(k.cacheRatio)}`);
    p(`compactions  ${k.compactions}${k.compactionsPerSession === null ? "" : ` (${k.compactionsPerSession.toFixed(2)}/session)`}`);
  }

  static #span(r: SpanRowDto): string {
    return `${"  ".repeat(r.depth)}${r.name}  ${r.durationMs}ms  ${r.status}${r.detail ? `  ${r.detail}` : ""}`
      + `${r.tokens ? `  tokens=${r.tokens.input}+${r.tokens.output}` : ""}${r.cost === null ? "" : `  cost=${r.cost.toFixed(4)}`}${r.incomplete ? "  incomplete" : ""}`;
  }

  // Las proyecciones las mantiene el host; el CLI no las ejecuta, sólo avisa si van por detrás del log.
  #hints(only?: ProjectionName): boolean {
    const behind = this.#d.lag.execute(only);
    for (const b of behind) this.#d.print(`projections behind (${b.position}/${b.last}): start pi in this project or run underpass events rebuild ${b.projection}`);
    return behind.length > 0;
  }

  #usage(): number { this.#d.print(USAGE); return 2; }
}
