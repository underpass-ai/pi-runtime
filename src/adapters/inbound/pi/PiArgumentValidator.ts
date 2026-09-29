// El validador de argumentos del propio Pi (`validateToolArguments` de pi-ai, con su coacción y su
// poda de nulls) visto como función: true si Pi acepta esos argumentos para esa tool. Lo inyecta el
// entry, que es el único sitio donde se resuelve el paquete de Pi.
export type PiArgumentValidator = (tool: { name: string; parameters: unknown }, args: unknown) => boolean;
