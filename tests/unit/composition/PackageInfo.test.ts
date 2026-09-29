import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PackageInfo } from "../../../src/composition/PackageInfo.ts";

test("PackageInfo.version() lee la versión de package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(PackageInfo.version(), pkg.version);
  assert.match(PackageInfo.version(), /^\d+\.\d+\.\d+/);
});
