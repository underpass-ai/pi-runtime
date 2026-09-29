import { DomainError } from "../../domain/shared/DomainError.ts";
import { FactMapper } from "../mappers/FactMapper.ts";
import type { OrphanSpoolSource } from "../ports/OrphanSpoolSource.ts";
import type { RecordFact } from "./RecordFact.ts";

// El host adopta los spools huérfanos: registra cada hecho por el mismo
// camino que el IPC `record` (idempotente por event_id, así que un fichero
// drenado a medias se puede repetir) y sólo entonces lo borra. Un hecho
// inválido (DomainError) se cuenta y se descarta, como haría el IPC; cualquier
// otro fallo deja el fichero reclamado para el siguiente intento. claims() y
// adopt() permiten decidir fichero a fichero (retroceso en OrphanSpoolAdoption).
export class AdoptOrphanSpools {
  readonly #source: OrphanSpoolSource; readonly #record: Pick<RecordFact, "execute">; readonly #mapper = new FactMapper();
  constructor(source: OrphanSpoolSource, record: Pick<RecordFact, "execute">) { this.#source = source; this.#record = record; }

  execute(): { files: number; recorded: number; invalid: number; retained: number } {
    const claims = this.claims();
    let recorded = 0; let invalid = 0; let retained = 0;
    for (const claim of claims) {
      const r = this.adopt(claim);
      recorded += r.recorded; invalid += r.invalid; if (r.failure !== null) retained++;
    }
    return { files: claims.length, recorded, invalid, retained };
  }

  claims(): string[] { return this.#source.claim(); }

  // failure: null si el fichero se registró entero y se borró; si no, el motivo por el que se conserva.
  adopt(claim: string): { recorded: number; invalid: number; failure: string | null } {
    const { facts, unreadable } = this.#source.read(claim);
    let recorded = 0; let invalid = unreadable;
    for (const dto of facts) {
      try { this.#record.execute(this.#mapper.toDomain(dto)); recorded++; }
      catch (e) {
        if (e instanceof DomainError) { invalid++; continue; }
        return { recorded, invalid, failure: (e as Error)?.message ?? String(e) };
      }
    }
    this.#source.release(claim);
    return { recorded, invalid, failure: null };
  }
}
