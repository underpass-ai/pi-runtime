import { fileURLToPath } from "node:url";

// Ficheros del propio paquete (pins.json, bin/…) como rutas del sistema.
// fileURLToPath y no `new URL(...).pathname`: éste deja los espacios y demás
// caracteres escapados (%20) y la ruta no existe si el paquete vive en una así.
export class RepoFile {
  private constructor() {}
  static path(relative: string): string { return fileURLToPath(new URL(`../../${relative}`, import.meta.url)); }
}
