import type { ToolName } from "../mcp/ToolName.ts";
import type { ArgumentProblem } from "./ArgumentProblem.ts";

const MAX_LINES = 12;

// El resultado de revisar unos argumentos contra el esquema de su tool. Vacío = nada que decir
// (Pi valida después igualmente).
export class ArgumentDiagnosis {
  readonly problems: readonly ArgumentProblem[];
  private constructor(problems: readonly ArgumentProblem[]) { this.problems = problems; }
  static of(problems: readonly ArgumentProblem[]): ArgumentDiagnosis { return new ArgumentDiagnosis([...problems]); }
  static readonly CLEAN = new ArgumentDiagnosis([]);
  clean(): boolean { return this.problems.length === 0; }

  // Un mensaje por ruta, en orden de aparición, con la pista del esquema al final de su línea.
  render(tool: ToolName): string {
    const byPath = new Map<string, { messages: string[]; hints: string[] }>();
    for (const p of this.problems) {
      const key = p.path.toString();
      const entry = byPath.get(key) ?? { messages: [], hints: [] };
      if (!entry.messages.includes(p.message)) entry.messages.push(p.message);
      if (p.hint !== null && !entry.hints.includes(p.hint)) entry.hints.push(p.hint);
      byPath.set(key, entry);
    }
    const lines = [...byPath].map(([path, e]) => `  - ${path}: ${e.messages.join("; ")}${e.hints.length ? ` — ${e.hints.join(" ")}` : ""}`);
    const shown = lines.slice(0, MAX_LINES);
    if (lines.length > MAX_LINES) shown.push(`  - …and ${lines.length - MAX_LINES} more`);
    return `${tool.value}: the arguments do not match its input schema. Fix these and call it again:\n${shown.join("\n")}`;
  }
}
