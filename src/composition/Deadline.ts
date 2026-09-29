// Espera acotada para el apagado del host: la exportación final nunca lo retiene.
export class Deadline {
  private constructor() {}

  // Espera `work` como mucho `ms`: true si terminó (bien o mal), false si venció el tope.
  // Nunca lanza; el temporizador se cancela en cuanto hay respuesta.
  static async within(work: Promise<void>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
    try { return await Promise.race([work.then(() => true, () => true), deadline]); }
    finally { clearTimeout(timer); }
  }
}
