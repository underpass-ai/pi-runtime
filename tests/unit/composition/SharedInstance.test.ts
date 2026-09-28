import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { SharedInstance } from "../../../src/composition/SharedInstance.ts";

test("la misma clave siempre da la misma instancia", () => {
  let calls = 0;
  const factory = () => { calls++; return { id: calls }; };
  const a = SharedInstance.get("test.same-module", factory);
  const b = SharedInstance.get("test.same-module", factory);
  assert.equal(a, b);
  assert.equal(calls, 1);
});

test("claves distintas dan instancias distintas", () => {
  const a = SharedInstance.get("test.key-a", () => ({ tag: "a" }));
  const b = SharedInstance.get("test.key-b", () => ({ tag: "b" }));
  assert.notEqual(a, b);
});

// Pi carga cada extensión con jiti en un realm de módulos propio
// (moduleCache: false): host.ts, kmp.ts y made.ts ven cada uno su PROPIA
// copia recién evaluada de SharedInstance.ts, con su propia clase y por
// tanto (si el registro viviera en una variable de módulo o campo estático)
// su propio mapa. Reproducimos eso aquí importando el mismo fichero dos
// veces con un query de cache-busting, que fuerza a Node a evaluarlo como
// dos módulos ESM distintos. El registro debe seguir siendo el mismo porque
// vive en globalThis, no en el ámbito del módulo.
test("el registro se comparte entre realms de módulos distintos (globalThis, no ámbito de módulo)", async () => {
  const url = pathToFileURL(new URL("../../../src/composition/SharedInstance.ts", import.meta.url).pathname).href;
  const realmA = await import(`${url}?realm=a`);
  const realmB = await import(`${url}?realm=b`);
  assert.notEqual(realmA.SharedInstance, realmB.SharedInstance, "el test no probaría nada si Node reutilizase el mismo módulo");

  let calls = 0;
  const factory = () => { calls++; return { id: calls }; };
  const fromA = realmA.SharedInstance.get("test.cross-realm", factory);
  const fromB = realmB.SharedInstance.get("test.cross-realm", factory);
  assert.equal(fromA, fromB);
  assert.equal(calls, 1);
});
