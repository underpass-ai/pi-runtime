import type { EvalGroupDto } from "./EvalGroupDto.ts";
import type { ShadowEvalDto } from "./ShadowEvalDto.ts";

// Evaluación de L1 por contexto (clave `<fase>|<proyecto>`).
export type LearningEvalDto = { context: string; phase: string; project: string; shadow: ShadowEvalDto; treated: EvalGroupDto; control: EvalGroupDto };
