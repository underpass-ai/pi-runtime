// Lo que doctor sabe del store de MADE sin abrirlo para escribir (S3a §5): cuántas políticas de
// autorización guarda y cuántos grants distintos emitió alguien que no es pi-runtime (sus ids no
// empiezan por `pi-runtime-`). Sólo cuentas, nunca ids.
export type MadeStoreCensusDto = { policies: number; foreignGrants: number };
