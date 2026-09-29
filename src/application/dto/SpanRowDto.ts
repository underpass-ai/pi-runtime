// Una fila de `underpass events trace`: el span a su profundidad en el árbol. tokens y cost sólo en turnos.
export type SpanRowDto = {
  depth: number;
  name: string;
  startedAt: string;
  durationMs: number;
  status: string;
  detail: string | null;
  tokens: { input: number; output: number } | null;
  cost: number | null;
  incomplete: boolean;
};
