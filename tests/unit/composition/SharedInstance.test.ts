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

// ExtensionComposition versiona la clave del HostExtension con el `version`
// de package.json (p.ej. "underpass-pi.host-extension@0.1.0") para que un
// `underpass update` seguido de una recarga de extensiones en el mismo
// proceso de pi no reutilice la instancia de una versión anterior. Esto
// prueba esa propiedad a nivel de SharedInstance: sólo la parte de versión
// de la clave debe decidir si se comparte o no.
test("claves que sólo difieren en versión dan instancias distintas; la misma versión comparte", () => {
  const v1a = SharedInstance.get("underpass-pi.host-extension@0.1.0", () => ({ v: "0.1.0", n: 1 }));
  const v1b = SharedInstance.get("underpass-pi.host-extension@0.1.0", () => ({ v: "0.1.0", n: 2 }));
  const v2 = SharedInstance.get("underpass-pi.host-extension@0.2.0", () => ({ v: "0.2.0", n: 3 }));
  assert.equal(v1a, v1b);
  assert.notEqual(v1a, v2);
});

// Pi carga cada extensión con jiti en un realm de módulos propio
// (moduleCache: false): host.ts, kmp.ts y made.ts ven cada uno su PROPIA
// copia recién evaluada de SharedInstance.ts, con su propia clase y por
// tanto (si el registro viviera en una variable de módulo o campo estático)
// su propio mapa. Reproducimos eso aquí importando el mismo fichero dos
// veces con un query de cache-busting, que fuerza a Node a evaluarlo como
// dos módulos ESM distintos. El registro debe seguir siendo el mismo porque
// vive en globalThis, no en el ámbito del módulo. Ese mismo aislamiento de
// jiti, ya en las extensiones reales de Pi (no simulado), queda cubierto de
// extremo a extremo por tests/acceptance/load-extensions.ts.
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
