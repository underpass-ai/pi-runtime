import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RepoFile } from "../../../src/composition/RepoFile.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("resuelve ficheros del paquete como rutas del sistema", () => {
  assert.equal(RepoFile.path("pins.json"), join(ROOT, "pins.json"));
  assert.equal(RepoFile.path("bin/underpass-host.ts"), join(ROOT, "bin/underpass-host.ts"));
});

// Con `new URL(...).pathname` un espacio llega como %20 y pins.json no se encuentra.
test("instalado bajo una ruta con espacios, pins.json y el cableado del host siguen resolviéndose", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "underpass-")), "con espacio");
  mkdirSync(root);
  for (const f of ["src", "bin", "pins.json", "package.json"]) cpSync(join(ROOT, f), join(root, f), { recursive: true });
  const copy = async <T>(file: string): Promise<T> => (await import(pathToFileURL(join(root, file)).href)) as T;

  const { RepoFile: Copied } = await copy<{ RepoFile: typeof RepoFile }>("src/composition/RepoFile.ts");
  assert.equal(Copied.path("pins.json"), join(root, "pins.json"));
  assert.ok(existsSync(Copied.path("bin/underpass-host.ts")));

  type Host = { HostComposition: { commands(env: Record<string, string>, paths: unknown): Map<string, unknown> } };
  const { HostComposition } = await copy<Host>("src/composition/HostComposition.ts");
  const { StatePaths } = await copy<{ StatePaths: new (env: Record<string, string>) => unknown }>("src/composition/StatePaths.ts");
  const env = { HOME: root };
  assert.deepEqual([...HostComposition.commands(env, new StatePaths(env)).keys()], ["kmp", "made"]);
});
