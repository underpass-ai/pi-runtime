import type { CheckDto } from "../../../application/dto/CheckDto.ts";

export class CheckRenderer {
  render(checks: CheckDto[]): string {
    const sections = [...new Set(checks.map((c) => c.section))];
    return sections.map((s) => [`[${s}]`, ...checks.filter((c) => c.section === s).map((c) => `  ${c.status.padEnd(4)} ${c.name} — ${c.detail}`)].join("\n")).join("\n");
  }
}
