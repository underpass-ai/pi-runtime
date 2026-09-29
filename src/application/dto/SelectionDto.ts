// Respuesta del IPC `select` (spec §7). Sólo `active` sin control reduce las tools activas:
// Pi expone entonces floor ∪ selected ∪ sus propias tools.
export type SelectionDto = { mode: "off" | "shadow" | "active" | "fallback"; control: boolean; selected: string[]; floor: string[] };
