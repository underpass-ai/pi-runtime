import { join } from "node:path";
import type { Project } from "../domain/project/Project.ts";

export class StatePaths {
  readonly #env: Record<string, string | undefined>;
  constructor(env: Record<string, string | undefined>) { this.#env = env; }
  root(): string { return join(this.#env.XDG_STATE_HOME ?? join(this.#env.HOME ?? "", ".local/state"), "underpass-pi"); }
  projectDir(p: Project): string { return join(this.root(), "projects", p.id.value); }
  socketOf(p: Project): string { return join(this.projectDir(p), "host.sock"); }
  binDir(): string { return join(this.#env.XDG_DATA_HOME ?? join(this.#env.HOME ?? "", ".local/share"), "underpass-pi", "bin"); }
  fingerprintsFile(): string { return join(this.root(), "fingerprints.json"); }
}
