import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OwnerLock } from "../../../application/ports/OwnerLock.ts";
import type { OwnerLockAcquisition } from "../../../application/ports/OwnerLockAcquisition.ts";

const ATTEMPTS = 400;
const BACKOFF_MS = 5;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Lock de propietario único del host de un proyecto.
//
// - Tomarlo es atómico: se escribe un temporal propio y se enlaza con link(),
//   que falla si host.lock ya existe (no hay ventana entre comprobar y crear).
// - Un lock huérfano (pid muerto o contenido corrupto) sólo se retira
//   renombrándolo a un nombre propio, y sólo con la guarda de desalojo
//   (host.lock.evict, creada con O_EXCL) en la mano, tras releer que sigue
//   siendo exactamente el huérfano que se vio. Sin esa guarda, con tres o más
//   procesos compitiendo, uno podía apartar el lock recién tomado por otro y
//   dejar dos dueños (reproducido por el test de carrera bajo carga).
// - Tras tomarlo se relee y se confirma que el contenido es el nuestro.
// - release() sólo borra el lock si sigue conteniendo nuestro token.
export class FsOwnerLock implements OwnerLock {
  readonly #file: string; readonly #guard: string;
  constructor(dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); this.#file = join(dir, "host.lock"); this.#guard = join(dir, "host.lock.evict"); }

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

  #tryLink(token: string): void { this.#linkNew(this.#file, JSON.stringify({ pid: process.pid, token }), token); }

  #linkNew(target: string, content: string, token: string): boolean {
    const tmp = `${target}.${process.pid}.${token}.tmp`;
    writeFileSync(tmp, content, { flag: "wx", mode: 0o600 });
    try { linkSync(tmp, target); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; return false; }
    finally { rmSync(tmp, { force: true }); }
  }

  #evict(seen: string): void {
    const guard = this.#takeGuard();
    if (guard === null) return; // otro está desalojando: la siguiente vuelta verá el resultado
    try {
      // Con la guarda nadie más retira host.lock, y link() no puede pisarlo
      // mientras exista: si aún es el huérfano visto, lo sigue siendo al apartarlo.
      if (this.#readRaw(this.#file) !== seen) return;
      const aside = `${this.#file}.stale.${process.pid}.${randomUUID()}`;
      try { renameSync(this.#file, aside); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
      rmSync(aside, { force: true });
    } finally {
      if (this.#readRaw(this.#guard) === guard) rmSync(this.#guard, { force: true });
    }
  }

  #takeGuard(): string | null {
    const token = randomUUID();
    const mark = JSON.stringify({ pid: process.pid, token });
    // Igual que host.lock: temporal completo + link(), para que nadie lea
    // nunca una guarda a medio escribir (vacía) y la tome por abandonada.
    if (this.#linkNew(this.#guard, mark, token)) return mark;
    const held = this.#readRaw(this.#guard);
    const holder = held === null ? -1 : this.#parse(held).pid;
    if (held !== null && (holder <= 0 || !this.#alive(holder))) {
      // Guarda de un proceso que murió dentro del desalojo (ventana de microsegundos).
      const aside = `${this.#guard}.stale.${process.pid}.${randomUUID()}`;
      try { renameSync(this.#guard, aside); } catch { return null; /* otro la limpió */ }
      if (this.#readRaw(aside) !== held) { try { linkSync(aside, this.#guard); } catch { /* ya hay otra guarda */ } }
      rmSync(aside, { force: true });
    } else {
      pause(BACKOFF_MS);
    }
    return null;
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
