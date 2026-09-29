import type { ExportEventLog } from "../../../application/use-cases/ExportEventLog.ts";
import type { ImportEventLog } from "../../../application/use-cases/ImportEventLog.ts";
import type { ListSessions } from "../../../application/use-cases/ListSessions.ts";
import type { RebuildProjection } from "../../../application/use-cases/RebuildProjection.ts";
import type { ShowSession } from "../../../application/use-cases/ShowSession.ts";
import type { ToolStatsReport } from "../../../application/use-cases/ToolStatsReport.ts";
import type { VerifyEventLog } from "../../../application/use-cases/VerifyEventLog.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ProjectionName } from "../../../domain/events/ProjectionName.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import { StreamId } from "../../../domain/events/StreamId.ts";
import { CanonicalJson } from "../../../domain/shared/CanonicalJson.ts";

type Deps = {
  sessions: ListSessions; show: ShowSession; tools: ToolStatsReport; verify: VerifyEventLog; exportLog: ExportEventLog; importLog: ImportEventLog;
  rebuild: RebuildProjection; readFile: (path: string) => string; print: (s: string) => void;
};
const USAGE = "usage: underpass events sessions|show <session>|tools|verify [--stream s]|export [--since n]|import <file>|rebuild <projection>";
const opt = (args: string[], flag: string): string | null => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? "" : null; };

export class EventsCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  run(args: string[]): number {
    const [cmd, arg] = args; const d = this.#d;
    try {
      switch (cmd) {
        case "sessions": {
          const sessions = d.sessions.execute();
          if (sessions.length === 0) d.print("no sessions recorded yet");
          for (const s of sessions) d.print(`${s.sessionId}  ${s.openedAt ?? "-"}  ${s.phase ?? "-"}  turns=${s.turns}  tokens=${s.tokens.input}+${s.tokens.output}  cost=${s.cost.toFixed(4)}  failures=${s.failures}`);
          return 0;
        }
        case "show":
          if (!arg) return this.#usage();
          for (const r of d.show.execute(SessionId.of(arg))) d.print(`v${r.version}  ${r.occurredAt}  ${r.type}  ${CanonicalJson.of(r.payload).text}`);
          return 0;
        case "tools": {
          const rows = d.tools.execute();
          if (rows.length === 0) d.print("no tool calls recorded yet");
          for (const t of rows) d.print(`${t.server}/${t.tool}  n=${t.n}  ok=${t.succeeded}  fail=${t.failed}  refused=${t.refused}  aborted=${t.aborted}  p50=${t.p50 ?? "-"}  p95=${t.p95 ?? "-"}`);
          return 0;
        }
        case "verify": {
          const s = opt(args, "--stream");
          if (s === "") return this.#usage();
          const results = d.verify.execute(s === null ? undefined : StreamId.of(s));
          if (results.length === 0) d.print("no streams recorded yet");
          for (const x of results) d.print(`${x.stream.value}  ${x.result.kind}${x.result.reason ? ` at v${x.result.version?.value}: ${x.result.reason}` : ""}`);
          return results.some((x) => x.result.kind === "broken") ? 1 : 0;
        }
        case "export": {
          const since = opt(args, "--since");
          if (since !== null && !/^\d+$/.test(since)) return this.#usage();
          for (const l of d.exportLog.execute(since === null ? GlobalPosition.START : GlobalPosition.of(Number(since)))) d.print(l);
          return 0;
        }
        case "import":
          if (!arg) return this.#usage();
          d.print(`imported ${d.importLog.execute(d.readFile(arg).split("\n"))} events`);
          return 0;
        case "rebuild":
          if (!arg) return this.#usage();
          d.rebuild.execute(ProjectionName.of(arg));
          d.print(`rebuilt ${arg}`);
          return 0;
        default:
          return this.#usage();
      }
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }

  #usage(): number { this.#d.print(USAGE); return 2; }
}
