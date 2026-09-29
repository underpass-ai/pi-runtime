import type { ServerCommandFactory } from "../../../application/ports/ServerCommandFactory.ts";
import type { ServerCommandDto } from "../../../application/dto/ServerCommandDto.ts";
import type { Project } from "../../../domain/project/Project.ts";

export class KmpServerCommandFactory implements ServerCommandFactory {
  readonly #binary: string; readonly #env: Record<string, string | undefined>;
  constructor(binary: string, env: Record<string, string | undefined>) { this.#binary = binary; this.#env = env; }
  commandFor(project: Project): ServerCommandDto {
    return { command: this.#binary, args: [], cwd: project.root.value, env: { ...this.#env, KMP_MCP_BACKEND: this.#env.KMP_MCP_BACKEND ?? "embedded" } };
  }
}
