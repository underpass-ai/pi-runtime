import type { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { ProjectionRunner } from "../services/ProjectionRunner.ts";

export class RebuildProjection {
  readonly #runner: ProjectionRunner;
  constructor(runner: ProjectionRunner) { this.#runner = runner; }
  execute(name: ProjectionName): void { this.#runner.rebuild(name); }
}
