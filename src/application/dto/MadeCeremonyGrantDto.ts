// Un grant de una instancia arrancada por la sesión (F3): id, acción, estado y, si se revocó, el motivo.
export type MadeCeremonyGrantDto = { grantId: string; action: string; state: string; reason: string | null };
