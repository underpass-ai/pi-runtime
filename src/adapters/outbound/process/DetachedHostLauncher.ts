import { spawn } from "node:child_process";
import type { HostLauncher } from "../../../application/ports/HostLauncher.ts";
import type { Project } from "../../../domain/project/Project.ts";

export class DetachedHostLauncher implements HostLauncher {
  readonly #entry: string; readonly #env: Record<string, string | undefined>;
  constructor(hostEntry: string, env: Record<string, string | undefined>) { this.#entry = hostEntry; this.#env = env; }
  launch(project: Project): void {
    spawn(process.execPath, [this.#entry, project.root.value], { env: this.#env, detached: true, stdio: "ignore" }).unref();
  }
}
