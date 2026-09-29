#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// node:sqlite (log de eventos) emite un ExperimentalWarning al cargarse. El shebang lo silencia al ejecutar
// el fichero directamente; para `node bin/underpass.ts` se filtra aquí ese aviso concreto antes de cargar
// la composición (import dinámico: los estáticos se enlazarían antes de instalar el filtro).
const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
  return (emitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;

const { CliComposition } = await import("../src/composition/CliComposition.ts");
try {
  process.exit(await CliComposition.build(process.env, (s) => console.log(s)).run(process.argv.slice(2)));
} catch (e) {
  // UNDERPASS_DEBUG muestra la pila completa; por defecto, una línea limpia.
  const detail = e instanceof Error ? (process.env.UNDERPASS_DEBUG ? e.stack ?? e.message : e.message) : String(e);
  console.error(`underpass: ${detail}`);
  process.exit(1);
}
