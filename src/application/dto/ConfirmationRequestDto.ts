// Lo que viaja en la negativa `needs_confirmation` (S3a §3): el token que la extensión reenvía
// si el usuario acepta, la acción de MADE y el alcance legible. Nunca argumentos.
export type ConfirmationRequestDto = { token: string; action: string; scopeSummary: string };
