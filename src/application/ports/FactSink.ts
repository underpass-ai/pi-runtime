import type { FactDto } from "../dto/FactDto.ts";

// Destino de los hechos capturados en Pi. `record` no bloquea ni falla:
// si el host no está, el hecho espera en el spool hasta el siguiente flush.
export interface FactSink { record(fact: FactDto): void; flush(): Promise<void> }
