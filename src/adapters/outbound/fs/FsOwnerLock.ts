import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OwnerLock } from "../../../application/ports/OwnerLock.ts";
import type { OwnerLockAcquisition } from "../../../application/ports/OwnerLockAcquisition.ts";

const ATTEMPTS = 8;

// Lock de propietario único del host de un proyecto.
//
// - Tomarlo es atómico: se escribe un temporal propio y se enlaza con link(),
//   que falla si host.lock ya existe (no hay ventana entre comprobar y crear).
// - Un lock huérfano (pid muerto o contenido corrupto) sólo se retira
//   renombrándolo a un nombre propio; si lo apartado no es lo que se leyó
//   (otro proceso lo tomó entretanto) se devuelve a su sitio.
// - Tras tomarlo se relee y se confirma que el contenido es el nuestro.
// - release() sólo borra el lock si sigue conteniendo nuestro token.
export class FsOwnerLock implements OwnerLock {
  readonly #file: string;
  constructor(dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); this.#file = join(dir, "host.lock"); }

  acquire(): OwnerLockAcquisition {
    const mine = new Set<string>();
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const token = randomUUID();
      mine.add(token);
      this.#tryLink(token);
      const raw = this.#readRaw(this.#file);
      if (raw === null) continue; // alguien lo apartó justo ahora: otra vuelta
      const owner = this.#parse(raw);
      if (owner.token !== null && mine.has(owner.token)) return { owned: true, release: () => this.#release(owner.token!) };
      if (owner.pid > 0 && this.#alive(owner.pid)) return { owned: false, ownerPid: owner.pid };
      this.#evict(raw);
    }
    throw new Error(`could not acquire ${this.#file}`);
  }

  #tryLink(token: string): void {
    const tmp = `${this.#file}.${process.pid}.${token}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 });
    try { linkSync(tmp, this.#file); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    finally { rmSync(tmp, { force: true }); }
  }

  #evict(seen: string): void {
    const aside = `${this.#file}.stale.${process.pid}.${randomUUID()}`;
    try { renameSync(this.#file, aside); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    if (this.#readRaw(aside) !== seen) {
      // No era el huérfano que vimos: otro proceso lo tomó entre leerlo y apartarlo.
      try { linkSync(aside, this.#file); } catch { /* ya hay otro dueño; la siguiente vuelta lo verá */ }
    }
    rmSync(aside, { force: true });
  }

  #release(token: string): void {
    const raw = this.#readRaw(this.#file);
    if (raw !== null && this.#parse(raw).token === token) rmSync(this.#file, { force: true });
  }

  #readRaw(path: string): string | null {
    try { return readFileSync(path, "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }

  #parse(raw: string): { pid: number; token: string | null } {
    try {
      const v = JSON.parse(raw) as { pid?: unknown; token?: unknown };
      return { pid: Number(v.pid) || -1, token: typeof v.token === "string" ? v.token : null };
    } catch { return { pid: -1, token: null }; }
  }

  #alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } }
}
