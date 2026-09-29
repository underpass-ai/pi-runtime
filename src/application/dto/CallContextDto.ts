// Contexto de una llamada a una tool (S3a §2): la sesión de Pi, su fase (null si la extensión
// no la sabe) y el token de una confirmación aceptada.
export type CallContextDto = { sessionId: string; phase: string | null; confirmation?: string };
