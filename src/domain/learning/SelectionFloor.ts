import { ToolName } from "../mcp/ToolName.ts";

const STANDARD = ["kmp_ask", "kmp_wake", "made_discover_capabilities", "made_get_status"];

// Mínimo fijo (spec §1): siempre activo si la fase lo permite y fuera del bandit.
export class SelectionFloor {
  readonly #names: ReadonlySet<string>;
  private constructor(names: string[]) { this.#names = new Set(names); }
  static readonly STANDARD = new SelectionFloor(STANDARD);

  static of(names: ToolName[]): SelectionFloor { return new SelectionFloor(names.map((n) => n.value)); }

  has(name: ToolName): boolean { return this.#names.has(name.value); }
  // Las tools del mínimo que la fase permite, ordenadas por nombre.
  within(allowed: ToolName[]): ToolName[] { return allowed.filter((t) => this.has(t)).sort((a, b) => a.value.localeCompare(b.value)); }
  // Las candidatas: lo que la fase permite menos el mínimo, ordenadas por nombre.
  candidates(allowed: ToolName[]): ToolName[] { return allowed.filter((t) => !this.has(t)).sort((a, b) => a.value.localeCompare(b.value)); }
}
