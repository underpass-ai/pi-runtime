// Recuentos de shadow: candidatas usadas y cuántas habría dejado fuera la selección, y el
// tamaño (tools y bytes de esquema) del conjunto completo frente al que habría expuesto.
export type ShadowEvalDto = { decisions: number; used: number; missed: number; fullTools: number; exposedTools: number; fullBytes: number; exposedBytes: number };
