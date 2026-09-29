import { spawn } from "node:child_process";
import { closeSync, fchmodSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { HostLauncher } from "../../../application/ports/HostLauncher.ts";
import type { Project } from "../../../domain/project/Project.ts";

// Lanza el host desacoplado de Pi: cwd "/" (no retiene el directorio del
// proyecto ni lo usa para resolver nada) y stdout/stderr al log del proyecto
// en su directorio de estado, en modo append y 0600, para poder diagnosticar
// un host que muere al arrancar.
export class DetachedHostLauncher implements HostLauncher {
  readonly #entry: string; readonly #env: Record<string, string | undefined>; readonly #logOf: (p: Project) => string;
  constructor(hostEntry: string, env: Record<string, string | undefined>, logOf: (p: Project) => string) { this.#entry = hostEntry; this.#env = env; this.#logOf = logOf; }
  launch(project: Project): void {
    const log = this.#logOf(project);
    mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
    const fd = openSync(log, "a", 0o600);
    try {
      fchmodSync(fd, 0o600);
      spawn(process.execPath, ["--disable-warning=ExperimentalWarning", this.#entry, project.root.value], { cwd: "/", env: this.#env, detached: true, stdio: ["ignore", fd, fd] }).unref();
    } finally {
      closeSync(fd);
    }
  }
}
