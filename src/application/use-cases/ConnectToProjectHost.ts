import type { Project } from "../../domain/project/Project.ts";
import type { HostGateway } from "../ports/HostGateway.ts";
import type { HostLauncher } from "../ports/HostLauncher.ts";
import type { ProjectLocator } from "../ports/ProjectLocator.ts";

type Connect = (socket: string, retries: number) => Promise<HostGateway>;
const LAUNCH_RETRIES = 50; // 50 × 100 ms = 5 s para que el host abra su socket

export class ConnectToProjectHost {
  readonly #locator: ProjectLocator; readonly #connect: Connect; readonly #socketOf: (p: Project) => string; readonly #launcher: HostLauncher;
  constructor(locator: ProjectLocator, connect: Connect, socketOf: (p: Project) => string, launcher: HostLauncher) {
    this.#locator = locator; this.#connect = connect; this.#socketOf = socketOf; this.#launcher = launcher;
  }
  async execute(cwd: string): Promise<HostGateway> {
    const project = this.#locator.locate(cwd);
    const socket = this.#socketOf(project);
    try { return await this.#connect(socket, 0); }
    catch {
      this.#launcher.launch(project);
      return this.#connect(socket, LAUNCH_RETRIES);
    }
  }
}
