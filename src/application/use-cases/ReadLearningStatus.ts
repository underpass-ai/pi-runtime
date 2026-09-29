import type { SessionId } from "../../domain/events/SessionId.ts";
import type { LearningEvalDto } from "../dto/LearningEvalDto.ts";
import type { LearningModeDto } from "../dto/LearningModeDto.ts";
import type { LearningStatusDto } from "../dto/LearningStatusDto.ts";
import type { SessionLearningDto } from "../dto/SessionLearningDto.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { LearningEvalProjection } from "../projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../projections/ToolBanditProjection.ts";

// Estado de L1 para /underpass-status (spec §8).
export class ReadLearningStatus {
  readonly #store: ProjectionStore;
  constructor(store: ProjectionStore) { this.#store = store; }

  execute(id: SessionId): LearningStatusDto {
    const mode = (this.#store.load(ToolBanditProjection.NAME).get(ToolBanditProjection.MODE_KEY) as LearningModeDto | undefined) ?? ToolBanditProjection.DEFAULT_MODE;
    const evals = this.#store.load(LearningEvalProjection.NAME);
    const last = evals.get(LearningEvalProjection.sessionKey(id.value)) as SessionLearningDto | undefined;
    const shadow = last === undefined ? undefined : (evals.get(LearningEvalProjection.contextKey(last.context)) as LearningEvalDto | undefined)?.shadow;
    return { mode: mode.mode, selected: last?.selected ?? null, candidates: last?.candidates ?? null, missRate: shadow && shadow.used > 0 ? shadow.missed / shadow.used : null };
  }
}
