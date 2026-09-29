import type { MadeCeremonyGrantDto } from "./MadeCeremonyGrantDto.ts";

// Una instancia de ceremonia que arrancó una sesión (F3): id, definición legible, si sigue en marcha
// o cómo terminó, y los grants del host con alcance a ella. Sólo identidad, nunca contexto ni salidas.
export type MadeCeremonyDto = {
  session: string; ceremonyId: string; summary: string; state: "running" | "ended"; endReason: string | null; startedAt: string; grants: MadeCeremonyGrantDto[];
};
