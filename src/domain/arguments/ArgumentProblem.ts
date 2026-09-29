import type { ArgumentPath } from "./ArgumentPath.ts";

// Un fallo concreto en un punto de los argumentos. `hint` es lo que el esquema dice de ese punto
// (su descripción o, sin ella, su forma), para que el modelo lo corrija de una vez.
export class ArgumentProblem {
  readonly path: ArgumentPath; readonly message: string; readonly hint: string | null;
  private constructor(path: ArgumentPath, message: string, hint: string | null) { this.path = path; this.message = message; this.hint = hint; }
  static at(path: ArgumentPath, message: string, hint: string | null = null): ArgumentProblem { return new ArgumentProblem(path, message, hint); }
  toString(): string { return `${this.path}: ${this.message}`; }
}
