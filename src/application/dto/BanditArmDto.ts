// Estado de un brazo del bandit: sus observaciones [recompensa, peso] dentro de la ventana.
export type BanditArmDto = { context: string; phase: string; project: string; tool: string; obs: [number, number][] };
