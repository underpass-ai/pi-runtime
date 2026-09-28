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

test("verbos y exit codes", async () => {
  const out: string[] = [];
  const cli = new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(true) }, (s) => out.push(s));
  assert.equal(await cli.run(["setup"]), 1);  // setup + doctor; doctor falla
  assert.equal(await cli.run(["update"]), 1);
  assert.equal(await cli.run(["doctor"]), 1);
  assert.equal(await cli.run(["nope"]), 2);
  assert.match(out.join("\n"), /FAIL profile made-worker/);
});
