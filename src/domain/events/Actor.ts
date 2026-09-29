import { DomainError } from "../shared/DomainError.ts";

const KINDS = ["human", "agent", "host"];

export class Actor {
  readonly kind: string; readonly id: string;
  private constructor(kind: string, id: string) { this.kind = kind; this.id = id; }
  static of(kind: string, id: string): Actor {
    if (typeof kind !== "string" || !KINDS.includes(kind)) throw DomainError.because(`invalid actor kind "${kind}"`);
    if (typeof id !== "string" || !/^[^\u0000-\u001f\s]{1,128}$/.test(id)) throw DomainError.because(`invalid actor id "${id}"`);
    return new Actor(kind, id);
  }
  equals(o: Actor): boolean { return o.kind === this.kind && o.id === this.id; }
}
