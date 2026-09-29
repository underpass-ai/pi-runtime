import type { FactDto } from "../dto/FactDto.ts";

// Spools de procesos de Pi que murieron sin vaciarlos. claim() los reclama
// (y recoge los que otro host dejó reclamados a medias) y devuelve sus
// identificadores; release() los borra una vez registrados.
export interface OrphanSpoolSource {
  claim(): string[];
  read(claim: string): { facts: FactDto[]; unreadable: number };
  release(claim: string): void;
}
