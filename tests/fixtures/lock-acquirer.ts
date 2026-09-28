#!/usr/bin/env node
// Adquiere el FsOwnerLock de argv[2] a la vez que otros procesos: espera en
// activo hasta el instante argv[3] (ms epoch) para maximizar la carrera,
// imprime {"owned":bool} y, si es dueño, retiene el lock (proceso vivo)
// durante argv[4] ms para que los demás lo vean ocupado.
import { FsOwnerLock } from "../../src/adapters/outbound/fs/FsOwnerLock.ts";

const [dir, startAt, holdMs] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4] ?? 800)];
const lock = new FsOwnerLock(dir);
while (Date.now() < startAt) { /* barrera */ }
const got = lock.acquire();
process.stdout.write(JSON.stringify({ owned: got.owned }) + "\n");
if (got.owned) setTimeout(() => got.release(), holdMs);
