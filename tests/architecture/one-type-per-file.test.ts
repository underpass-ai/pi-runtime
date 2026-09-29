import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceFiles } from "./source-files.ts";

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

test("un archivo, una clase / interfaz / tipo", () => {
  const offenders = sourceFiles().filter(({ path, text }) => {
    if (path.startsWith("src/adapters/inbound/pi/entry/")) return count(text, /^\s*(export\s+)?(abstract\s+)?class\s/gm) > 0;
    const declarations = count(text, /^\s*(export\s+)?(abstract\s+)?class\s/gm)
      + count(text, /^\s*export\s+interface\s/gm)
      + count(text, /^\s*export\s+type\s+\w+\s*=/gm);
    return declarations !== 1;
  }).map((f) => f.path);
  assert.deepEqual(offenders, []);
});

test("los VOs de dominio tienen constructor privado", () => {
  const offenders = sourceFiles()
    .filter(({ path, text }) => path.startsWith("src/domain/") && /extends ValueObject</.test(text) && !/private constructor/.test(text))
    .map((f) => f.path);
  assert.deepEqual(offenders, []);
});
