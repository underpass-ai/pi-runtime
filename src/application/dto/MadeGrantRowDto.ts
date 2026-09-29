// Una fila de `underpass made grants` (S3a §5): sólo ids, acción, alcance legible, clase, caducidad,
// estado y, si se revocó, el motivo.
export type MadeGrantRowDto = { grantId: string; session: string; action: string; scope: string; class: string; validUntil: string; state: string; reason: string | null };
