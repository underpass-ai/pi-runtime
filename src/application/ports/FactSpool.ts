import type { FactDto } from "../dto/FactDto.ts";

// Cola persistente y ordenada de hechos pendientes de entregar al host.
export interface FactSpool { append(fact: FactDto): void; readAll(): FactDto[]; removeFirst(n: number): void; pending(): number }
