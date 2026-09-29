import { test } from "node:test";
import assert from "node:assert/strict";
import { UnderpassCli } from "../../../../../src/adapters/inbound/cli/UnderpassCli.ts";
import { CheckRenderer } from "../../../../../src/adapters/inbound/cli/CheckRenderer.ts";
import { DiagnosisReport } from "../../../../../src/domain/diagnosis/DiagnosisReport.ts";
import { Check } from "../../../../../src/domain/diagnosis/Check.ts";
import { CheckSection } from "../../../../../src/domain/diagnosis/CheckSection.ts";
import { CheckName } from "../../../../../src/domain/diagnosis/CheckName.ts";
import { CheckDetail } from "../../../../../src/domain/diagnosis/CheckDetail.ts";

const report = (fail: boolean) => DiagnosisReport.of([(fail ? Check.fail : Check.ok)(CheckSection.MADE, CheckName.of("profile made-worker"), CheckDetail.of("d"))]);

test("render agrupa por sección", () => {
  assert.equal(new CheckRenderer().render([{ section: "kmp", status: "OK", name: "a", detail: "b" }, { section: "kmp", status: "FAIL", name: "c", detail: "d" }]), "[kmp]\n  OK   a — b\n  FAIL c — d");
});

test("setup y update imprimen dos bloques con título, uno por informe; salen con 1 si alguno falla", async () => {
  const out: string[] = [];
  const cli = new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(true) }, (s) => out.push(s));
  assert.equal(await cli.run(["setup"]), 1);
  const setupOutput = out.join("\n");
  assert.match(setupOutput, /== setup ==\n\[made\]\n  OK   profile made-worker/);
  assert.match(setupOutput, /== doctor ==\n\[made\]\n  FAIL profile made-worker/);

  out.length = 0;
  assert.equal(await cli.run(["update"]), 1);
  const updateOutput = out.join("\n");
  assert.match(updateOutput, /== setup ==/);
  assert.match(updateOutput, /== doctor ==/);
});

test("setup y update salen con 0 si ambos informes están limpios", async () => {
  const out: string[] = [];
  const cli = new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(false) }, (s) => out.push(s));
  assert.equal(await cli.run(["setup"]), 0);
  assert.equal(await cli.run(["update"]), 0);
});

test("doctor imprime sólo su informe, sin títulos", async () => {
  const out: string[] = [];
  const cli = new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(true) }, (s) => out.push(s));
  assert.equal(await cli.run(["doctor"]), 1);
  const doctorOutput = out.join("\n");
  assert.equal(doctorOutput.includes("=="), false);
  assert.match(doctorOutput, /FAIL profile made-worker/);
});

test("verbo desconocido devuelve 2 y muestra el uso", async () => {
  const out: string[] = [];
  const cli = new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(false) }, (s) => out.push(s));
  assert.equal(await cli.run(["nope"]), 2);
  assert.match(out.join("\n"), /usage: underpass setup \| doctor \| update/);
});
