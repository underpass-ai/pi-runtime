import { test } from "node:test";
import assert from "node:assert/strict";
import { MadeCli } from "../../../../../src/adapters/inbound/cli/MadeCli.ts";
import { UnderpassCli } from "../../../../../src/adapters/inbound/cli/UnderpassCli.ts";
import type { ListMadeCeremonies } from "../../../../../src/application/use-cases/ListMadeCeremonies.ts";
import type { ListMadeGrants } from "../../../../../src/application/use-cases/ListMadeGrants.ts";
import type { RevokeMadeGrants } from "../../../../../src/application/use-cases/RevokeMadeGrants.ts";
import { DiagnosisReport } from "../../../../../src/domain/diagnosis/DiagnosisReport.ts";

const ROW = { grantId: `pi-runtime-${"a".repeat(32)}`, session: "s1", action: "validate_ceremony_draft", scope: "definition d v1.0", class: "auto", validUntil: "2026-09-30T22:00:00.000Z", state: "active", reason: null };
const cli = (rows: unknown[] | Error, revoke: { orphans: number; revoked: number } | Error = { orphans: 0, revoked: 0 }) => {
  const out: string[] = [];
  const grants = { execute: () => { if (rows instanceof Error) throw rows; return rows; } } as unknown as ListMadeGrants;
  const revoker = { execute: async () => { if (revoke instanceof Error) throw revoke; return revoke; } } as unknown as RevokeMadeGrants;
  return { out, cli: new MadeCli({ grants, revoke: revoker, print: (s) => out.push(s) }) };
};

test("grants: una línea por grant con id, estado, clase, acción, alcance, caducidad y sesión", async () => {
  const a = cli([ROW, { ...ROW, grantId: `pi-runtime-${"b".repeat(32)}`, state: "revoked", reason: "consumed", class: "confirm", action: "publish_ceremony_definition" }]);
  assert.equal(await a.cli.run(["grants"]), 0);
  assert.deepEqual(a.out, [
    `pi-runtime-${"a".repeat(32)}  active   auto     validate_ceremony_draft  definition d v1.0  until 2026-09-30T22:00:00.000Z  session s1`,
    `pi-runtime-${"b".repeat(32)}  revoked (consumed)  confirm  publish_ceremony_definition  definition d v1.0  until 2026-09-30T22:00:00.000Z  session s1`,
  ]);
  const none = cli([]);
  assert.equal(await none.cli.run(["grants"]), 0);
  assert.deepEqual(none.out, ["no MADE grants issued by the host"]);
});

test("ceremonies: cada instancia arrancada por una sesión y sus grants; sin cablear, uso", async () => {
  const out: string[] = [];
  const rows = [{ session: "s1", ceremonyId: "c1", summary: "ceremony c1 (smoke v1.0)", state: "ended", endReason: "completed", startedAt: "2026-09-30T10:00:00.000Z",
    grants: [{ grantId: "pi-runtime-a", action: "claim_ceremony_step", state: "revoked", reason: "ceremony_ended" }, { grantId: "pi-runtime-b", action: "get_ceremony_instance", state: "active", reason: null }] },
  { session: "s2", ceremonyId: "c2", summary: "ceremony c2", state: "running", endReason: null, startedAt: "2026-09-30T11:00:00.000Z", grants: [] }];
  let list: unknown[] = rows;
  const ceremonies = { execute: () => list } as unknown as ListMadeCeremonies;
  const c = new MadeCli({ grants: { execute: () => [] } as unknown as ListMadeGrants, ceremonies, revoke: {} as RevokeMadeGrants, print: (s) => out.push(s) });
  assert.equal(await c.run(["ceremonies"]), 0);
  assert.deepEqual(out, [
    "ceremony c1 (smoke v1.0)  ended (completed)  started 2026-09-30T10:00:00.000Z  session s1",
    "  pi-runtime-a  revoked (ceremony_ended)  claim_ceremony_step",
    "  pi-runtime-b  active  get_ceremony_instance",
    "ceremony c2  running  started 2026-09-30T11:00:00.000Z  session s2",
  ]);
  list = []; out.length = 0;
  assert.equal(await c.run(["ceremonies"]), 0);
  assert.deepEqual(out, ["no MADE ceremonies started by a session"]);
  const old = cli([]);
  assert.equal(await old.cli.run(["ceremonies"]), 2, "sin el caso de uso, uso");
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
    assert.deepEqual(a.out, ["usage: underpass made grants | ceremonies | revoke-orphans"]);
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
  assert.match(out.at(-1)!, /made <grants\|ceremonies\|revoke-orphans>/);
});
