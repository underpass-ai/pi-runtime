import type { MadeConfigurationRepository } from "../../../application/ports/MadeConfigurationRepository.ts";
import type { ServerCommandFactory } from "../../../application/ports/ServerCommandFactory.ts";
import type { ServerCommandDto } from "../../../application/dto/ServerCommandDto.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";
import type { Project } from "../../../domain/project/Project.ts";
import { MadeServerCommandFactory } from "./MadeServerCommandFactory.ts";

// Comando de MADE que lee la configuración privada en el momento de arrancar
// el servidor, nunca antes, y sólo la lee: crearla es cosa de `underpass
// setup` (EnsureMadeConfiguration). Lo comparten el host y `doctor`.
export class LazyMadeServerCommandFactory implements ServerCommandFactory {
  readonly #binary: string; readonly #store: StorePath; readonly #configs: MadeConfigurationRepository; readonly #env: Record<string, string | undefined>;
  constructor(binary: string, store: StorePath, configs: MadeConfigurationRepository, env: Record<string, string | undefined>) {
    this.#binary = binary; this.#store = store; this.#configs = configs; this.#env = env;
  }
  commandFor(project: Project): ServerCommandDto {
    const configuration = this.#configs.load(this.#store);
    if (!configuration) throw new Error("MADE private configuration missing; run `underpass setup`");
    return new MadeServerCommandFactory(this.#binary, this.#store, configuration, this.#env).commandFor(project);
  }
}
