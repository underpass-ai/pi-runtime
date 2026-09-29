// Error del puerto MadeConfigurationRepository: la configuración privada de
// MADE falta o no es válida. Permite a doctor distinguirlo de un fallo al
// arrancar el servidor.
export class MadeConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "MadeConfigurationError"; }
}
