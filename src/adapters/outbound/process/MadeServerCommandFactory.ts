import type { ServerCommandFactory } from "../../../application/ports/ServerCommandFactory.ts";
import type { ServerCommandDto } from "../../../application/dto/ServerCommandDto.ts";
import type { MadeConfiguration } from "../../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";
import type { Project } from "../../../domain/project/Project.ts";

export class MadeServerCommandFactory implements ServerCommandFactory {
  readonly #binary: string; readonly #store: StorePath; readonly #config: MadeConfiguration; readonly #env: Record<string, string | undefined>;
  constructor(binary: string, store: StorePath, config: MadeConfiguration, env: Record<string, string | undefined>) {
    this.#binary = binary; this.#store = store; this.#config = config; this.#env = env;
  }
  commandFor(project: Project): ServerCommandDto {
    return { command: this.#binary, args: [], cwd: project.root.value,
      env: { ...this.#env, ...Object.fromEntries(this.#config.entries()), MADE_MCP_BACKEND: "embedded", MADE_MCP_STORE_PATH: this.#store.value } };
  }
}
