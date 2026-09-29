import { ValueObject } from "../shared/ValueObject.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Dónde está un argumento dentro de la llamada, tal como se lo enseñamos al modelo:
// `stages[0].group.repeat`. La raíz se llama `arguments`.
export class ArgumentPath extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly ROOT = new ArgumentPath("");
  isRoot(): boolean { return this.value === ""; }
  field(name: string): ArgumentPath {
    const step = IDENTIFIER.test(name) ? name : JSON.stringify(name);
    if (this.isRoot()) return new ArgumentPath(IDENTIFIER.test(name) ? name : `[${step}]`);
    return new ArgumentPath(IDENTIFIER.test(name) ? `${this.value}.${name}` : `${this.value}[${step}]`);
  }
  index(i: number): ArgumentPath { return new ArgumentPath(`${this.isRoot() ? "arguments" : this.value}[${i}]`); }
  toString(): string { return this.isRoot() ? "arguments" : this.value; }
}
