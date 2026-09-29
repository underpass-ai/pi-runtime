import type { MadeCeremonyDto } from "./MadeCeremonyDto.ts";

// S3a en /underpass-status: grants del host vigentes en la sesión y confirmaciones pedidas. F3
// añade las instancias que arrancó la sesión (opcional: un host anterior no lo envía).
export type SessionMadeDto = { activeGrants: number; confirmations: number; ceremonies?: MadeCeremonyDto[] };
