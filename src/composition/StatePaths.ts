import { isAbsolute, join } from "node:path";
import { StorePath } from "../domain/made/StorePath.ts";
import type { Project } from "../domain/project/Project.ts";

type Env = Record<string, string | undefined>;

// Única fuente de rutas derivadas del entorno. Resuelve con la semántica de
// shell `${VAR:-default}` (una variable vacía cuenta como no definida) y
// exige que el resultado sea absoluto: con HOME vacío o un XDG_* relativo,
// una ruta relativa acabaría resolviéndose contra el cwd (p. ej. la clave
// HMAC de MADE dentro del repo), así que es un error.
export class StatePaths {
  readonly #env: Env;
  constructor(env: Env) { this.#env = env; }

  root(): string { return join(this.#xdg("XDG_STATE_HOME", ".local/state"), "pi-runtime"); }
  projectDir(p: Project): string { return join(this.root(), "projects", p.id.value); }
  socketOf(p: Project): string { return join(this.projectDir(p), "host.sock"); }
  hostLogOf(p: Project): string { return join(this.projectDir(p), "host.log"); }
  hostStderrOf(p: Project): string { return join(this.projectDir(p), "host.stderr.log"); }
  eventLogOf(p: Project): string { return join(this.projectDir(p), "events.sqlite3"); }
  spoolDirOf(p: Project): string { return join(this.projectDir(p), "spool"); }
  binDir(): string { return join(this.#xdg("XDG_DATA_HOME", ".local/share"), "pi-runtime", "bin"); }
  fingerprintsFile(): string { return join(this.root(), "fingerprints.json"); }

  // ${MADE_MCP_STORE_PATH:-${XDG_STATE_HOME:-~/.local/state}/underpass-made/ceremonies.sqlite3}
  madeStore(): StorePath {
    const explicit = this.#set("MADE_MCP_STORE_PATH");
    return StorePath.of(explicit !== null
      ? this.#absolute(explicit, "MADE_MCP_STORE_PATH")
      : join(this.#xdg("XDG_STATE_HOME", ".local/state"), "underpass-made", "ceremonies.sqlite3"));
  }

  // ${MADE_SETUP_CONFIG_ROOT:-${XDG_CONFIG_HOME:-~/.config}/underpass-made/embedded}
  madeConfigRoot(): string {
    const explicit = this.#set("MADE_SETUP_CONFIG_ROOT");
    return explicit !== null
      ? this.#absolute(explicit, "MADE_SETUP_CONFIG_ROOT")
      : join(this.#xdg("XDG_CONFIG_HOME", ".config"), "underpass-made", "embedded");
  }

  #xdg(name: string, homeRelative: string): string {
    const explicit = this.#set(name);
    if (explicit !== null) return this.#absolute(explicit, name);
    return this.#absolute(join(this.#set("HOME") ?? "", homeRelative), `HOME (default for ${name})`);
  }

  #set(name: string): string | null {
    const v = this.#env[name];
    return v === undefined || v === "" ? null : v;
  }

  #absolute(path: string, source: string): string {
    if (!isAbsolute(path)) throw new Error(`${source} must resolve to an absolute path, got "${path}"`);
    return path;
  }
}
