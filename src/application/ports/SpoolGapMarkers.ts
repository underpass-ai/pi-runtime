// Marcadores `<pid>.gap` que el spool deja al desbordarse (hechos perdidos).
// list() los nombra; remove() borra uno una vez que el operador lo ha revisado.
export interface SpoolGapMarkers {
  list(): string[];
  remove(marker: string): void;
}
