import { test } from "node:test";
import assert from "node:assert/strict";
import { MadeCli } from "../../../../../src/adapters/inbound/cli/MadeCli.ts";
import { UnderpassCli } from "../../../../../src/adapters/inbound/cli/UnderpassCli.ts";
import type { ListMadeGrants } from "../../../../../src/application/use-cases/ListMadeGrants.ts";
import type { RevokeMadeGrants } from "../../../../../src/application/use-cases/RevokeMadeGrants.ts";
import { DiagnosisReport } from "../../../../../src/domain/diagnosis/DiagnosisReport.ts";

const ROW = { grantId: `pi-runtime-${"a".repeat(32)}`, session: "s1", action: "validate_ceremony_draft", scope: "definition d v1.0", class: "auto", validUntil: "2026-09-30T22:00:00.000Z", state: "active" };
const cli = (rows: unknown[] | Error, revoke: { orphans: number; revoked: number } | Error = { orphans: 0, revoked: 0 }) => {
  const out: string[] = [];
  const grants = { execute: () => { if (rows instanceof Error) throw rows; return rows; } } as unknown as ListMadeGrants;
  const revoker = { execute: async () => { if (revoke instanceof Error) throw revoke; return revoke; } } as unknown as RevokeMadeGrants;
  return { out, cli: new MadeCli({ grants, revoke: revoker, print: (s) => out.push(s) }) };
};

test("grants: una línea por grant con id, estado, clase, acción, alcance, caducidad y sesión", async () => {
  const a = cli([ROW, { ...ROW, grantId: `pi-runtime-${"b".repeat(32)}`, state: "revoked", class: "confirm", action: "publish_ceremony_definition" }]);
  assert.equal(await a.cli.run(["grants"]), 0);
  assert.deepEqual(a.out, [
    `pi-runtime-${"a".repeat(32)}  active   auto     validate_ceremony_draft  definition d v1.0  until 2026-09-30T22:00:00.000Z  session s1`,
    `pi-runtime-${"b".repeat(32)}  revoked  confirm  publish_ceremony_definition  definition d v1.0  until 2026-09-30T22:00:00.000Z  session s1`,
  ]);
  const none = cli([]);
  assert.equal(await none.cli.run(["grants"]), 0);
  assert.deepEqual(none.out, ["no MADE grants issued by the host"]);
});

test("revoke-orphans: cuenta lo revocado; si quedan huérfanos sin revocar sale con 1", async () => {
  const none = cli([]);
  assert.equal(await none.cli.run(["revoke-orphans"]), 0);
  assert.deepEqual(none.out, ["no orphan MADE grants"]);
  const all = cli([], { orphans: 2, revoked: 2 });
  assert.equal(await all.cli.run(["revoke-orphans"]), 0);
  assert.deepEqual(all.out, ["revoked 2/2 orphan MADE grants"]);
  const some = cli([], { orphans: 2, revoked: 1 });
  assert.equal(await some.cli.run(["revoke-orphans"]), 1);
});

test("uso incorrecto sale con 2 y un fallo con 1 y el mensaje", async () => {
  for (const args of [[], ["nope"], ["grants", "--all"]]) {
    const a = cli([]);
    assert.equal(await a.cli.run(args), 2, JSON.stringify(args));
    assert.deepEqual(a.out, ["usage: underpass made grants | revoke-orphans"]);
  }
  const broken = cli(new Error("log unreadable"));
  assert.equal(await broken.cli.run(["grants"]), 1);
  assert.deepEqual(broken.out, ["error: log unreadable"]);
});

test("underpass made delega en su verbo; sin él, el uso lo anuncia", async () => {
  const out: string[] = []; const seen: string[][] = [];
  const doctor = { execute: async () => DiagnosisReport.of([]) };
  const cliWith = new UnderpassCli(doctor, doctor, (s) => out.push(s), null, null, null, { run: async (a) => { seen.push(a); return 7; } });
  assert.equal(await cliWith.run(["made", "grants"]), 7);
  assert.deepEqual(seen, [["grants"]]);
  const cliWithout = new UnderpassCli(doctor, doctor, (s) => out.push(s));
  assert.equal(await cliWithout.run(["made", "grants"]), 2);
  assert.match(out.at(-1)!, /made <grants\|revoke-orphans>/);
});
