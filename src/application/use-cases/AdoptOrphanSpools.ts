import { DomainError } from "../../domain/shared/DomainError.ts";
import { FactMapper } from "../mappers/FactMapper.ts";
import type { OrphanSpoolSource } from "../ports/OrphanSpoolSource.ts";
import type { RecordFact } from "./RecordFact.ts";

// El host adopta los spools huérfanos: registra cada hecho por el mismo
// camino que el IPC `record` (idempotente por event_id, así que un fichero
// drenado a medias se puede repetir) y sólo entonces lo borra. Un hecho
// inválido (DomainError) se cuenta y se descarta, como haría el IPC; cualquier
// otro fallo deja el fichero reclamado para el siguiente intento.
export class AdoptOrphanSpools {
  readonly #source: OrphanSpoolSource; readonly #record: Pick<RecordFact, "execute">; readonly #mapper = new FactMapper();
  constructor(source: OrphanSpoolSource, record: Pick<RecordFact, "execute">) { this.#source = source; this.#record = record; }

  execute(): { files: number; recorded: number; invalid: number; retained: number } {
    const claims = this.#source.claim();
    let recorded = 0; let invalid = 0; let retained = 0;
    for (const claim of claims) {
      const { facts, unreadable } = this.#source.read(claim);
      invalid += unreadable;
      let complete = true;
      for (const dto of facts) {
        try { this.#record.execute(this.#mapper.toDomain(dto)); recorded++; }
        catch (e) {
          if (e instanceof DomainError) { invalid++; continue; }
          complete = false; break;
        }
      }
      if (complete) this.#source.release(claim); else retained++;
    }
    return { files: claims.length, recorded, invalid, retained };
  }
}
