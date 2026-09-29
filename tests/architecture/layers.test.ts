import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, normalize } from "node:path";
import { importsOf, sourceFiles } from "./source-files.ts";

const layerOf = (path: string) => path.split("/")[1]; // src/<layer>/...
const ALLOWED: Record<string, string[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  adapters: ["domain", "application", "adapters"],
  composition: ["domain", "application", "adapters", "composition"],
};
const NODE_ALLOWED_IN_DOMAIN = new Set(["node:crypto"]);
const isEntry = (path: string) => path.startsWith("src/adapters/inbound/pi/entry/");

test("cada capa sólo importa las capas permitidas", () => {
  const violations: string[] = [];
  for (const file of sourceFiles()) {
    const layer = layerOf(file.path);
    for (const spec of importsOf(file.text)) {
      if (spec.startsWith("node:")) {
        if ((layer === "domain" && !NODE_ALLOWED_IN_DOMAIN.has(spec)) || layer === "application") violations.push(`${file.path} -> ${spec}`);
        continue;
      }
      if (!spec.startsWith(".")) {
        if (!file.path.startsWith("src/adapters/inbound/pi/")) violations.push(`${file.path} -> ${spec} (external package)`);
        continue;
      }
      const target = normalize(join(dirname(file.path), spec));
      const targetLayer = layerOf(target);
      if (isEntry(file.path) && targetLayer === "composition") continue;
      if (!ALLOWED[layer]?.includes(targetLayer)) violations.push(`${file.path} -> ${target}`);
    }
  }
  assert.deepEqual(violations, []);
});
