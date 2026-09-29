#!/usr/bin/env node
// Adquiere el FsOwnerLock de argv[2] a la vez que otros procesos: espera en
// activo hasta el instante argv[3] (ms epoch) para maximizar la carrera e
// imprime {"owned":bool}. Si es dueño, retiene el lock (proceso vivo) hasta
// que el test cierra su stdin, para que los demás lo vean ocupado por lento
// que arranquen.
import { FsOwnerLock } from "../../src/adapters/outbound/fs/FsOwnerLock.ts";

const [dir, startAt] = [process.argv[2], Number(process.argv[3])];
const lock = new FsOwnerLock(dir);
while (Date.now() < startAt) { /* barrera */ }
const got = lock.acquire();
process.stdout.write(JSON.stringify({ owned: got.owned }) + "\n");
process.stdin.resume();
process.stdin.on("end", () => { if (got.owned) got.release(); process.exit(0); });
