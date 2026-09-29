# S3a Autorización de MADE gestionada por el host — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el host de Pi Runtime sea el punto de control de la autorización de MADE: cuando `made-mcp` deniega una llamada, el host lee la decisión, concede sola una lectura o un borrador con un grant exacto y reintenta una vez, pide confirmación humana en la TUI de Pi para lo que escribe, lo audita todo en el log de E1, revoca los grants al cerrar la sesión y al arrancar, y lo enseña en `doctor`, `/underpass-status` y `underpass made`.

**Architecture:** El dominio (`src/domain/made/`) tiene la tabla cerrada de clases (`MadeActionPolicy`: auto, confirm, never, con la fase mandando), los VOs de MADE (acción, alcance con su forma exacta, id de decisión con su cursor, id de grant determinista, grant con su vigencia), el token de confirmación de un solo uso ligado a la huella de la llamada y el contexto de llamada (sesión, fase, token). La aplicación añade los tres hechos v1 de S3a, el libro de grants que los lee del log, el dueño de la política (`MadeOwner`, que habla con MADE como trusted host), el caso de uso `CallMadeTool` (denegación → decisión → clase → grant o `needs_confirmation` → un único reintento), la revocación (`RevokeMadeGrants`), el rechazo de confirmaciones, el listado, el diagnóstico y el estado de sesión. Los adaptadores son los campos nuevos del IPC (`call` con sesión, fase y token; método `confirmation`), la confirmación en `PiToolFactory` con `ctx.ui.confirm` de Pi 0.87.1, el verbo `underpass made`, el censo de políticas del store de MADE en SQLite de sólo lectura y los lectores tolerantes del log.

**Tech Stack:** Node 22.23 (type stripping, `node:test`, `node:sqlite`, `node:crypto`), TypeScript borrable, Pi 0.87.1 (quinto argumento `ctx` de `execute` con `hasUI` y `ui.confirm`), `made-mcp` 0.8.0 en modo embebido. Sin dependencias npm.

**Spec:** `docs/specs/2026-09-30-s3a-made-authorization-design.md` (y, como contexto, `docs/specs/2026-09-28-pi-runtime-design.md`, `docs/specs/2026-09-29-e1-event-log-design.md` y L1 §12 en `docs/specs/2026-09-30-l1-learning-design.md`).

## Global Constraints

- **Hexagonal y DDD, sin primitive obsession:**
  - `src/domain/**` sólo importa `domain` y `node:crypto`; `src/application/**` sólo importa `domain` y `application`, nunca `node:*`.
  - `node:sqlite` sólo en `src/adapters/outbound/sqlite/`. `src/adapters/**` nunca importa `composition`.
  - Los paquetes externos sólo se importan bajo `src/adapters/inbound/pi/`. **Cero dependencias npm:** nunca `npm install`.
  - Una clase, `export interface` o `export type X =` por fichero en `src/` (los `type` no exportados dentro de un fichero no cuentan). Los VOs que extienden `ValueObject` tienen constructor privado.
  - Los conceptos de S3a son VOs o clases de dominio (`MadeActionClass`, `MadeAction`, `MadeScope`, `MadeDecisionId`, `MadeDecision`, `MadeGrantId`, `MadeGrant`, `RevocationReason`, `ConfirmationToken`, `CallDigest`, `ConfirmationOutcome`, `PendingConfirmation`, `MadeCallContext`). Los DTOs son primitivos. Todo `of(raw)`/`parse(raw)` rechaza entradas de tipo equivocado con `DomainError`.
  - Todos los tests de `tests/architecture/` siguen en verde.
- **Cobertura ≥ 80 %** de líneas, ramas y funciones con `npm test` (`bash scripts/test.sh`).
- **TypeScript borrable:** sin `enum`, `namespace`, parameter properties ni decoradores; imports relativos con `.ts`.
- **Privacidad:** hechos, logs del host, CLI, `doctor` y `/underpass-status` sólo llevan nombres de tools y acciones, tipos de alcance y nombres, versiones o ids de definición, ceremonia, artefacto, consejo o cuenta, ids de grant, de sesión y de decisión, instantes y resultados. Nunca texto de prompts, argumentos (el YAML de una definición tampoco) ni salidas, rutas o secretos. Nunca se imprime la clave HMAC de MADE.
- **Hechos nuevos, `type_version` 1** (spec §4): `made.grant_issued` en el stream de la sesión con `{grantId, action, scope, validUntil, class}`; `made.grant_revoked` en el stream `host` con `{grantId, session, reason}`; `made.confirmation` en el stream de la sesión con `{action, scopeSummary, outcome}`. Los registra sólo el host.
- **Vigencias** (spec §0, §2, §3): auto 12 h (revocado al cerrar), confirm 5 min, token 2 min y un solo uso; `delegation_depth` 0, sin padre, `grantee` = `issuer` = trusted host.
- **Seguridad:** nunca se toca el store ni la configuración reales de MADE (`~/.local/state/underpass-made`, `~/.config/underpass-made`) ni se emiten grants contra ellos fuera de una sesión real de Pi; los tests de integración y la aceptación usan store, configuración, `XDG_STATE_HOME` y datos de KMP temporales.
- **Tests:** en español, con `node:test` y `node:assert/strict`, en `tests/unit/<capa>/…` reflejando `src`; el contrato con `made-mcp` real, en `tests/contract/`.
- **Commits** en español con prefijo convencional, en la rama `feat/s3a-made-auth` (worktree `~/Documents/ai/pi-runtime-s3a`), con `git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit …`. Sin push. Nunca se toca `~/Documents/ai/pi-runtime` salvo en la tarea 13, como se describe allí.

---

## Mapa de ficheros

```text
src/domain/events/EventType.ts                    (+ stored, known, madeAudit; +3 tipos de S3a)
src/domain/session/PhaseToolSelection.ts          (+ exposes)
src/domain/diagnosis/CheckSection.ts              (+ MADE_AUTH)
src/domain/made/                                   MadeActionClass, MadeAction, MadeActionPolicy, MadeScope, MadeDecisionId, MadeDecision,
                                                   MadeGrantId, MadeGrant, RevocationReason, ConfirmationToken, CallDigest, ConfirmationOutcome,
                                                   PendingConfirmation, MadeCallContext
src/application/dto/                               ConfirmationRequestDto, CallContextDto, MadeGrantRowDto, SessionMadeDto,
                                                   HostRequestDto (+call con contexto, +confirmation), HostResponseDto (+confirmation), SessionStatusDto (+made)
src/application/ports/                             MadePolicyCensus, HostCallError (+confirmation), HostGateway (+contexto, +confirmation)
src/application/mappers/                           EventRecordMapper (tipos opacos), HostResponseMapper (+needsConfirmation)
src/application/services/                          PendingConfirmations, MadeFactFactory, MadeGrantLedger, MadeOwner, IssuedGrants, SelectionWindows (ignora auditoría)
src/application/use-cases/                         CallMadeTool, DeclineMadeConfirmation, RevokeMadeGrants, ListMadeGrants, DiagnoseMadeAuthorization,
                                                   ReadMadeStatus, ServeHostRequest (+MADE), DiagnoseInstallation (+made-auth), ReadSessionStatus (+made)
src/adapters/outbound/sqlite/                      SqliteEventStore (tipos opacos), SqliteMadePolicyCensus
src/adapters/outbound/ipc/UnixSocketHostGateway.ts (+contexto, +confirmation)
src/adapters/inbound/ipc/UnixSocketHostServer.ts   (ALLOWED + confirmation)
src/adapters/inbound/pi/                           PiToolFactory (confirmación), HostExtension (callContext, línea made:), ServerToolsExtension
src/adapters/inbound/cli/                          MadeCli, UnderpassCli (+made)
src/composition/                                   HostComposition, EventLogComposition, CliComposition
tests/support/FakeMade.ts, tests/fixtures/made-host.ts
tests/contract/made-authorization.contract.test.ts
tests/acceptance/made-auth-session.ts
docs/upstream/2026-09-30-made-s3a-issues.md, docs/acceptance/s3a.md, README.md
```

Orden de dependencias: 1 (lectores tolerantes, prerrequisito) → 2 → 3 → 4 → 5 (autorización de extremo a extremo en el host) → 6 (IPC) → 7 (extensión) · 8 (ciclo de vida) · 9, 10 (superficies) · 11 (contrato con `made-mcp` real) · 12 (documentación) · 13 (aceptación).

**Lo que hace MADE 0.8.0 en modo embebido, comprobado con el binario fijado sobre un store temporal (y la base de todo el plan):**

- Una tool de negocio sin grant vuelve como negativa con `structuredContent.code = "refused"` y el mensaje exacto `authorization decision <sha256 en hex> denied the operation` (`crates/made-mcp/src/embedded/embedded_tool_authorizer.rs`). La spec lo llama «código `authorization denied`»: en 0.8.0 el código es `refused` y lo que identifica la denegación es ese mensaje. `… has expired` es otro caso (una aprobación caducada) y no se trata.
- `made_list_authorization_decisions {after_decision_id?, limit≤500}` devuelve las decisiones ordenadas por `decision_id` con cursor exclusivo (`decision_id > cursor`). Con `after_decision_id` = el id menos uno (en hex de 64 cifras) y `limit` 1 se obtiene exactamente la decisión buscada, sin paginar. Cada decisión trae `action`, `scope` (`{"kind":"global"}`, `{"kind":"definition","name":…,"version":…}`, `ceremony`, `ceremony_tree`, `artifact`, `council`, `budget`) y `outcome` (`deny`/`allow`). La acción es la de MADE, que no siempre es el nombre de la tool: `made_get_budget_report` → `read_budget`.
- El dueño (el trusted host, único principal) lee la política (`made_get_authorization_policy`, `policy.owner.principal_id`) y las decisiones, y emite y revoca grants sin grants propios. `made_issue_authorization_grant` con el mismo id y el mismo contenido responde `existing: true`; con otro contenido, `conflict`. Revocar dos veces responde `existing: true`; un id desconocido, `not_found`; un grant caducado se revoca sin error.
- MADE no sabe de sesiones: un grant del trusted host sirve a todas las sesiones de Pi. Por eso revocar al cerrar una sesión puede quitarle a otra un grant que usaba; la siguiente llamada de esa otra sesión vuelve a concederse sola.
- `made_design_ceremony`, `made_list_contracts` y `made_diff_ceremony_definitions` se deciden con alcance `global` (§0.4); `validate`, `explain` y `publish` con `definition {name, version}` sacado del YAML.
- `made_get_help` y `made_discover_capabilities` no pasan por la autorización (se responden antes del backend): funcionan sin grants.

**Cómo sabe el host la fase de una llamada.** La extensión la envía: `HostExtension.callContext()` devuelve `{sessionId, phase}` de su estado (la sesión de `session_start` y la fase de `applyPhase`), y `PiToolFactory` lo adjunta a cada `call`. El host no guarda fases. Una extensión anterior no envía contexto y el host se comporta como antes (la denegación original); un host anterior ignora los campos nuevos.

---

### Task 1: Lectores tolerantes — un tipo de hecho desconocido se conserva opaco

Prerrequisito de §4 (y el pendiente de L1 §12): hoy `SqliteEventStore` y `EventRecordMapper` hacen `EventType.of(type)` al leer y lanzan con un tipo que no conocen, así que un log escrito por una versión posterior rompe la lectura entera. Con `EventType.stored` un tipo bien formado (`familia.nombre`) que esta versión no conoce se conserva opaco: se lee, se verifica su cadena (el hash usa el texto del tipo), se exporta e importa byte a byte y las proyecciones lo ignoran (todas despachan por `switch`/comparación de tipo). `EventType.of` no cambia: un hecho nuevo nunca lleva un tipo desconocido.

**Files:**
- Modify: `src/domain/events/EventType.ts`, `src/adapters/outbound/sqlite/SqliteEventStore.ts`, `src/application/mappers/EventRecordMapper.ts`
- Test: `tests/unit/application/use-cases/UnknownEventTypes.test.ts`

**Interfaces:**
- Consumes: `EventHasher.compute`, `EventRecord.restore`, `ProjectionRunner`, `HostComposition.projections()`, `ExportEventLog`, `ImportEventLog`, `VerifyEventLog`, `recordFixtures` (`AGENT`, `AT`, `SESSION`, `fact`).
- Produces:
  - `EventType.stored(raw: string): EventType` (conocido o bien formado `^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31}){1,3}$`; `DomainError` si no)
  - `EventType#known(): boolean` (false sólo para los opacos)
  - `SqliteEventStore` y `EventRecordMapper.toDomain` leen con `EventType.stored`

- [ ] **Step 1: Test que falla**

`tests/unit/application/use-cases/UnknownEventTypes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { ExportEventLog } from "../../../../src/application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../../../../src/application/use-cases/ImportEventLog.ts";
import { VerifyEventLog } from "../../../../src/application/use-cases/VerifyEventLog.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { HostComposition } from "../../../../src/composition/HostComposition.ts";
import { EventHasher } from "../../../../src/domain/events/EventHasher.ts";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { EventRecord } from "../../../../src/domain/events/EventRecord.ts";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { TypeVersion } from "../../../../src/domain/events/TypeVersion.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { CanonicalJson } from "../../../../src/domain/shared/CanonicalJson.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { AGENT, AT, SESSION, fact } from "../../../support/recordFixtures.ts";

// Un hecho de una versión futura: tipo desconocido, sellado detrás del último registro del stream.
function future(store: EventStore): EventRecord {
  const prev = store.readStream(SESSION).at(-1)!;
  const props = {
    id: EventId.of("session:s1:future.thing:x1"), stream: SESSION, version: StreamVersion.of(prev.version.value + 1), type: EventType.stored("future.thing"),
    typeVersion: TypeVersion.of(3), occurredAt: AT, recordedAt: AT, actor: AGENT, correlationId: prev.correlationId, causationId: prev.id,
    payload: CanonicalJson.of({ secret: "never read" }), prevHash: prev.hash,
  };
  return EventRecord.restore({ ...props, hash: EventHasher.compute(props) });
}

// El log con un hecho futuro en medio: opened, future.thing (importado ya sellado) y turn.completed detrás.
function seeded(store: EventStore): EventStore {
  store.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
  assert.equal(store.importSealed([future(store)]), 1);
  store.append(SESSION, StreamVersion.of(2), [fact("turn.completed", "t1", { model: "m" }, SESSION, 2_000)], AT);
  return store;
}

test("EventType.stored conserva un tipo desconocido bien formado y rechaza uno mal formado", () => {
  assert.equal(EventType.stored("session.opened").known(), true);
  assert.ok(EventType.stored("session.opened").equals(EventType.of("session.opened")));
  const opaque = EventType.stored("future.thing");
  assert.equal(opaque.known(), false);
  assert.equal(opaque.value, "future.thing");
  assert.equal(opaque.belongsToSessions(), false);
  assert.throws(() => EventType.of("future.thing"), DomainError, "un hecho nuevo nunca lleva un tipo desconocido");
  for (const bad of ["future", "Future.x", "a..b", "a.b c", "", 7 as never]) assert.throws(() => EventType.stored(bad), DomainError, String(bad));
});

for (const [label, open] of [["memoria", () => new InMemoryEventStore()], ["sqlite", () => new SqliteEventStore(SqliteDatabase.open(":memory:"))]] as const) {
  test(`${label}: un tipo desconocido se lee opaco, la cadena se verifica y los append siguientes encadenan`, () => {
    const store = seeded(open());
    const records = store.readStream(SESSION);
    assert.deepEqual(records.map((r) => [r.type.value, r.type.known()]), [["session.opened", true], ["future.thing", false], ["turn.completed", true]]);
    assert.equal(records[1].typeVersion.value, 3);
    assert.ok(new VerifyEventLog(store).execute(SESSION)[0].result.isIntact());
  });
}

test("export → import de un log con un tipo desconocido lo conserva byte a byte", () => {
  const src = seeded(new SqliteEventStore(SqliteDatabase.open(":memory:")));
  const lines = new ExportEventLog(src, ProjectId.of("0123456789abcdef")).execute();
  const dst = new SqliteEventStore(SqliteDatabase.open(":memory:"));
  assert.equal(new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute(lines).imported, 3);
  assert.deepEqual(dst.readStream(SESSION).map((r) => r.hash.value), src.readStream(SESSION).map((r) => r.hash.value));
  assert.ok(new VerifyEventLog(dst).execute().every((x) => x.result.isIntact()));
});

test("las proyecciones del host ignoran el tipo desconocido: nada en cuarentena", () => {
  const events = seeded(new InMemoryEventStore()); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, HostComposition.projections());
  runner.runOnce();
  for (const p of runner.projections()) {
    assert.deepEqual(store.quarantined(p.name), [], p.name.value);
    assert.equal(store.cursor(p.name)!.position.value, 3, p.name.value);
  }
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/UnknownEventTypes.test.ts`

Expected: FAIL con `TypeError: EventType.stored is not a function`.

- [ ] **Step 3: Implementar**

`src/domain/events/EventType.ts` (fichero completo, sustituye al actual):

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const SESSION = ["session.opened", "session.closed", "phase.changed", "turn.completed", "tool.started", "tool.completed", "model.selected", "context.compacted", "tools.selected"];
const HOST = ["host.started", "host.stopped", "server.started", "server.exited", "learning.mode_changed"];
// Forma de cualquier tipo de hecho, conocido o de una versión futura: `familia.nombre`.
const WELL_FORMED = /^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31}){1,3}$/;

export class EventType extends ValueObject<string> {
  readonly #known: boolean;
  private constructor(v: string, known: boolean) { super(v); this.#known = known; }

  // Un tipo que esta versión sabe registrar. Sólo éstos entran en hechos nuevos.
  static of(raw: string): EventType {
    if (typeof raw !== "string" || (!SESSION.includes(raw) && !HOST.includes(raw))) throw DomainError.because(`unknown event type "${raw}"`);
    return new EventType(raw, true);
  }

  // Lectores del log (S3a §4): un tipo que esta versión no conoce, pero bien formado, se
  // conserva opaco para que su registro se lea, se verifique y se exporte igual.
  static stored(raw: string): EventType {
    if (typeof raw === "string" && (SESSION.includes(raw) || HOST.includes(raw))) return new EventType(raw, true);
    if (typeof raw !== "string" || !WELL_FORMED.test(raw)) throw DomainError.because(`malformed event type "${raw}"`);
    return new EventType(raw, false);
  }

  known(): boolean { return this.#known; }
  belongsToSessions(): boolean { return SESSION.includes(this.value); }
}
```

En `src/adapters/outbound/sqlite/SqliteEventStore.ts`, sustituye:

```ts
    return EventRecord.restore({
      id: EventId.of(String(r.event_id)), stream: StreamId.of(String(r.stream)), version: StreamVersion.of(Number(r.version)), type: EventType.of(String(r.type)),
      typeVersion: TypeVersion.of(Number(r.type_version)), occurredAt: Timestamp.parse(String(r.occurred_at)), recordedAt: Timestamp.parse(String(r.recorded_at)),
```

por:

```ts
    return EventRecord.restore({
      id: EventId.of(String(r.event_id)), stream: StreamId.of(String(r.stream)), version: StreamVersion.of(Number(r.version)), type: EventType.stored(String(r.type)),
      typeVersion: TypeVersion.of(Number(r.type_version)), occurredAt: Timestamp.parse(String(r.occurred_at)), recordedAt: Timestamp.parse(String(r.recorded_at)),
```

En `src/application/mappers/EventRecordMapper.ts`, sustituye:

```ts
  toDomain(d: EventRecordDto): EventRecord {
    return EventRecord.restore({ id: EventId.of(d.eventId), stream: StreamId.of(d.stream), version: StreamVersion.of(d.version), type: EventType.of(d.type),
      typeVersion: TypeVersion.of(d.typeVersion), occurredAt: Timestamp.parse(d.occurredAt), recordedAt: Timestamp.parse(d.recordedAt), actor: Actor.of(d.actor?.kind, d.actor?.id),
```

por:

```ts
  toDomain(d: EventRecordDto): EventRecord {
    return EventRecord.restore({ id: EventId.of(d.eventId), stream: StreamId.of(d.stream), version: StreamVersion.of(d.version), type: EventType.stored(d.type),
      typeVersion: TypeVersion.of(d.typeVersion), occurredAt: Timestamp.parse(d.occurredAt), recordedAt: Timestamp.parse(d.recordedAt), actor: Actor.of(d.actor?.kind, d.actor?.id),
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/UnknownEventTypes.test.ts` y después `npm test`.

Expected: los 5 tests nuevos en verde; `npm test` en verde (574 tests), arquitectura incluida.

- [ ] **Step 5: Commit**

```bash
git add src/domain/events/EventType.ts src/adapters/outbound/sqlite/SqliteEventStore.ts src/application/mappers/EventRecordMapper.ts tests/unit/application/use-cases/UnknownEventTypes.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): los lectores del log conservan opacos los tipos de hecho desconocidos"
```

---

### Task 2: Dominio de la autorización de MADE — clases, alcances, decisiones y grants

La tabla cerrada de §1 y las piezas de §2. `MadeActionPolicy` clasifica por nombre de tool sin `made_` (auto, confirm o never; lo desconocido es confirm; lo que no es de MADE, never) y `admits` añade la fase: nada se concede si la fase actual no expone la tool. `MadeScope` conserva la forma exacta de MADE (tipo y campos de identidad) y da una clave estable y un resumen legible. `MadeDecisionId` reconoce la denegación exacta de 0.8.0 y calcula el cursor que deja la decisión primera de su página. `MadeGrant` es el grant exacto del host: id determinista, vigencia por clase, cobertura, argumentos de `made_issue_authorization_grant` y payload de `made.grant_issued`.

**Files:**
- Create: `src/domain/made/MadeActionClass.ts`, `src/domain/made/MadeAction.ts`, `src/domain/made/MadeActionPolicy.ts`, `src/domain/made/MadeScope.ts`, `src/domain/made/MadeDecisionId.ts`, `src/domain/made/MadeDecision.ts`, `src/domain/made/MadeGrantId.ts`, `src/domain/made/MadeGrant.ts`, `src/domain/made/RevocationReason.ts`
- Modify: `src/domain/session/PhaseToolSelection.ts`
- Test: `tests/unit/domain/made/authorization.test.ts`

**Interfaces:**
- Consumes: `ToolName`, `Phase`, `PhaseToolSelection.standard()`, `SessionId`, `Timestamp`, `TrustedHostId`, `CanonicalJson`, `ValueObject`, `DomainError`.
- Produces:
  - `MadeActionClass.{AUTO, CONFIRM, NEVER}`, `.of(raw)`, `#lifetimeMs()` (12 h, 5 min; never lanza)
  - `MadeAction.of(raw)` (`^[a-z][a-z0-9_]{0,63}$`)
  - `MadeActionPolicy.standard()`, `.of(phases: PhaseToolSelection)`, `#classify(tool: ToolName): MadeActionClass`, `#admits(tool: ToolName, phase: Phase | null): MadeActionClass | null`
  - `PhaseToolSelection#exposes(phase: Phase, tool: ToolName): boolean`
  - `MadeScope.GLOBAL`, `.parse(raw: unknown)`, `#kind`, `#toJson(): Record<string, string | null>`, `#key` (JSON canónico), `#equals(o)`, `#summary()` (`global`, `definition <name> v<version>`, `ceremony <id>`, `ceremony tree <id>`, `artifact <id>`, `council <id>`, `budget <id>`)
  - `MadeDecisionId.of(raw)` (64 hex), `.fromDenial(message: string): MadeDecisionId | null`, `#cursor(): string | null`
  - `MadeDecision.parse(raw: unknown)`, `#id`, `#action`, `#scope`, `#denied()`
  - `MadeGrantId.of(raw)` (`^pi-runtime-[0-9a-f]{32}$`), `.derive(session, action, scope, from: Timestamp)`
  - `MadeGrant.issue(session, action, scope, actionClass, now)`, `.fromFact(session, payload: unknown, validFrom: Timestamp)`, campos `id`, `session`, `action`, `scope`, `actionClass`, `validFrom`, `validUntil`; `#covers(action, scope, now)`, `#expired(now)`, `#issueArguments(grantee: TrustedHostId)`, `#toFactPayload()` = `{grantId, action, scope, validUntil, class}`
  - `RevocationReason.{SESSION_CLOSED, EXPIRED_CLEANUP}`, `.of(raw)`

- [ ] **Step 1: Test que falla**

`tests/unit/domain/made/authorization.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../../src/domain/made/MadeActionClass.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeDecision } from "../../../../src/domain/made/MadeDecision.ts";
import { MadeDecisionId } from "../../../../src/domain/made/MadeDecisionId.ts";
import { MadeGrant } from "../../../../src/domain/made/MadeGrant.ts";
import { MadeGrantId } from "../../../../src/domain/made/MadeGrantId.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { RevocationReason } from "../../../../src/domain/made/RevocationReason.ts";
import { TrustedHostId } from "../../../../src/domain/made/TrustedHostId.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const tool = (n: string) => ToolName.of(n);
const ID = "3b0bd929b09d10e02bdb74fad064bb39a6fda2acdc86d9b70c658171acbdda3b";
const DEF = { kind: "definition", name: "pr_review_two_reviewers", version: "1.0" };
const NOW = Timestamp.fromEpochMs(1_000_000);

test("clases: lecturas y borrador auto, escritura y lo desconocido confirm, administración never", () => {
  const p = MadeActionPolicy.standard();
  for (const n of ["made_get_status", "made_design_ceremony", "made_validate_ceremony_draft", "made_list_contracts", "made_get_budget_report", "made_diff_ceremony_definitions"]) assert.equal(p.classify(tool(n)), MadeActionClass.AUTO, n);
  for (const n of ["made_publish_ceremony_definition", "made_start_ceremony", "made_run_ceremony_step", "made_cancel_ceremony", "made_tombstone_artifact", "made_brand_new_verb"]) assert.equal(p.classify(tool(n)), MadeActionClass.CONFIRM, n);
  for (const n of ["made_issue_authorization_grant", "made_revoke_authorization_grant", "made_approve_authorization_operation", "made_get_authorization_policy", "made_list_authorization_decisions", "kmp_ask"]) assert.equal(p.classify(tool(n)), MadeActionClass.NEVER, n);
});

test("la fase manda: sólo se concede lo que la fase expone, y nunca lo never", () => {
  const p = MadeActionPolicy.standard();
  assert.equal(p.admits(tool("made_design_ceremony"), Phase.DESIGN), MadeActionClass.AUTO);
  assert.equal(p.admits(tool("made_publish_ceremony_definition"), Phase.DESIGN), MadeActionClass.CONFIRM);
  assert.equal(p.admits(tool("made_design_ceremony"), Phase.INTERACTIVE), null, "la fase interactiva no expone MADE");
  assert.equal(p.admits(tool("made_get_status"), Phase.DESIGN), null, "auto, pero ninguna fase la expone");
  assert.equal(p.admits(tool("made_design_ceremony"), null), null, "sin fase conocida no se concede nada");
  const open = MadeActionPolicy.of(PhaseToolSelection.of([[Phase.DESIGN, ["made_get_authorization_policy", "made_get_status"]]]));
  assert.equal(open.admits(tool("made_get_authorization_policy"), Phase.DESIGN), null);
  assert.equal(open.admits(tool("made_get_status"), Phase.DESIGN), MadeActionClass.AUTO);
  assert.equal(PhaseToolSelection.standard().exposes(Phase.DESIGN, tool("made_list_contracts")), true);
  assert.equal(PhaseToolSelection.standard().exposes(Phase.INTERACTIVE, tool("made_list_contracts")), false);
});

test("vigencia por clase: 12 h auto, 5 min confirm, never no se concede", () => {
  assert.equal(MadeActionClass.AUTO.lifetimeMs(), 12 * 3_600_000);
  assert.equal(MadeActionClass.CONFIRM.lifetimeMs(), 300_000);
  assert.throws(() => MadeActionClass.NEVER.lifetimeMs(), DomainError);
  assert.equal(MadeActionClass.of("confirm"), MadeActionClass.CONFIRM);
  assert.throws(() => MadeActionClass.of("maybe"), DomainError);
});

test("alcances: forma exacta de MADE, clave estable y resumen legible sin contenido", () => {
  const def = MadeScope.parse(DEF);
  assert.deepEqual(def.toJson(), DEF);
  assert.equal(def.summary(), "definition pr_review_two_reviewers v1.0");
  assert.equal(MadeScope.parse({ kind: "definition", name: "x" }).summary(), "definition x");
  assert.deepEqual(MadeScope.parse({ kind: "definition", name: "x" }).toJson(), { kind: "definition", name: "x", version: null });
  assert.equal(MadeScope.parse({ kind: "global" }), MadeScope.GLOBAL);
  assert.equal(MadeScope.GLOBAL.summary(), "global");
  assert.equal(MadeScope.parse({ kind: "ceremony", ceremony_id: "c-1" }).summary(), "ceremony c-1");
  assert.equal(MadeScope.parse({ kind: "ceremony_tree", root_id: "r-1" }).summary(), "ceremony tree r-1");
  assert.equal(MadeScope.parse({ kind: "budget", account_id: "b" }).summary(), "budget b");
  assert.ok(MadeScope.parse({ version: "1.0", name: "pr_review_two_reviewers", kind: "definition" }).equals(def), "el orden de las claves no importa");
  assert.ok(!def.equals(MadeScope.GLOBAL));
  for (const bad of [null, [], "global", { kind: "planet" }, { kind: "ceremony" }, { kind: "artifact", artifact_id: "" }, { kind: "definition", name: "x", version: 3 }, { kind: "council", council_id: "a\nb" }]) {
    assert.throws(() => MadeScope.parse(bad), DomainError, JSON.stringify(bad));
  }
});

test("decisiones: el id sale de la denegación exacta y su cursor la deja primera de la página", () => {
  const id = MadeDecisionId.fromDenial(`authorization decision ${ID} denied the operation`)!;
  assert.equal(id.value, ID);
  assert.equal(MadeDecisionId.fromDenial(`authorization decision ${ID} has expired`), null);
  assert.equal(MadeDecisionId.fromDenial("no grant"), null);
  assert.equal(MadeDecisionId.fromDenial(undefined as never), null);
  assert.equal(id.cursor(), "3b0bd929b09d10e02bdb74fad064bb39a6fda2acdc86d9b70c658171acbdda3a");
  assert.equal(MadeDecisionId.of("0".repeat(63) + "1").cursor(), "0".repeat(64));
  assert.equal(MadeDecisionId.of("0".repeat(64)).cursor(), null);
  assert.throws(() => MadeDecisionId.of("ABC"), DomainError);
  const d = MadeDecision.parse({ decision_id: ID, action: "publish_ceremony_definition", scope: DEF, outcome: "deny", principal: { principal_id: "h" } });
  assert.ok(d.id.equals(id) && d.action.value === "publish_ceremony_definition" && d.scope.summary() === "definition pr_review_two_reviewers v1.0" && d.denied());
  assert.equal(MadeDecision.parse({ decision_id: ID, action: "get_status", scope: { kind: "global" }, outcome: "allow" }).denied(), false);
  assert.throws(() => MadeDecision.parse(null), DomainError);
  assert.throws(() => MadeAction.of("Get-Status"), DomainError);
});

test("grants: id determinista, vigencia por clase, cobertura exacta y argumentos de MADE", () => {
  const s = SessionId.of("s1"); const action = MadeAction.of("validate_ceremony_draft"); const scope = MadeScope.parse(DEF);
  const g = MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, NOW);
  assert.ok(g.id.equals(MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, NOW).id), "mismo instante, mismo id");
  assert.ok(!g.id.equals(MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, Timestamp.fromEpochMs(NOW.epochMs() + 1)).id));
  assert.ok(!g.id.equals(MadeGrant.issue(SessionId.of("s2"), action, scope, MadeActionClass.AUTO, NOW).id));
  assert.match(g.id.value, /^pi-runtime-[0-9a-f]{32}$/);
  assert.equal(g.validUntil.epochMs() - NOW.epochMs(), 12 * 3_600_000);
  assert.ok(g.covers(action, MadeScope.parse(DEF), NOW));
  assert.ok(!g.covers(MadeAction.of("publish_ceremony_definition"), scope, NOW));
  assert.ok(!g.covers(action, MadeScope.GLOBAL, NOW));
  assert.ok(!g.covers(action, scope, g.validUntil), "valid_until es exclusivo");
  const host = TrustedHostId.of("made-local-host-abc");
  assert.deepEqual(g.issueArguments(host), { grant_id: g.id.value, grantee_id: "made-local-host-abc", actions: ["validate_ceremony_draft"], scope: DEF,
    valid_from: NOW.value, valid_until: g.validUntil.value, delegation_depth: 0 });
  const payload = g.toFactPayload();
  assert.deepEqual(payload, { grantId: g.id.value, action: "validate_ceremony_draft", scope: DEF, validUntil: g.validUntil.value, class: "auto" });
  const back = MadeGrant.fromFact(s, payload, NOW);
  assert.ok(back.id.equals(g.id) && back.actionClass === MadeActionClass.AUTO && back.covers(action, scope, NOW));
  assert.throws(() => MadeGrant.fromFact(s, null, NOW), DomainError);
  assert.equal(MadeGrant.issue(s, action, scope, MadeActionClass.CONFIRM, NOW).validUntil.epochMs() - NOW.epochMs(), 300_000);
  assert.throws(() => MadeGrant.issue(s, action, scope, MadeActionClass.NEVER, NOW), DomainError);
  assert.throws(() => MadeGrantId.of("someone-else"), DomainError);
});

test("motivos de revocación", () => {
  assert.equal(RevocationReason.of("session_closed"), RevocationReason.SESSION_CLOSED);
  assert.equal(RevocationReason.of("expired_cleanup"), RevocationReason.EXPIRED_CLEANUP);
  assert.throws(() => RevocationReason.of("bored"), DomainError);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/domain/made/authorization.test.ts`

Expected: FAIL por `Cannot find module …/src/domain/made/MadeAction.ts`.

- [ ] **Step 3: Implementar**

`src/domain/made/MadeActionClass.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const HOUR_MS = 3_600_000;

// Clase de una acción de MADE (S3a §1): auto (lectura o borrador, grant hasta el cierre de la
// sesión con tope de 12 h), confirm (escribe o ejecuta: confirmación humana y grant de 5 min)
// o never (administración de la autorización: nunca desde Pi).
export class MadeActionClass extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly AUTO = new MadeActionClass("auto");
  static readonly CONFIRM = new MadeActionClass("confirm");
  static readonly NEVER = new MadeActionClass("never");

  static of(raw: string): MadeActionClass {
    const found = [MadeActionClass.AUTO, MadeActionClass.CONFIRM, MadeActionClass.NEVER].find((c) => c.value === raw);
    if (typeof raw !== "string" || found === undefined) throw DomainError.because(`unknown MADE action class ${raw}`);
    return found;
  }

  // Vigencia del grant que la acción justifica.
  lifetimeMs(): number {
    if (this.equals(MadeActionClass.AUTO)) return 12 * HOUR_MS;
    if (this.equals(MadeActionClass.CONFIRM)) return 5 * 60_000;
    throw DomainError.because("a never action is never granted");
  }
}
```

`src/domain/made/MadeAction.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Acción de autorización de MADE tal como la escribe una decisión (`get_status`, `read_budget`…).
export class MadeAction extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): MadeAction {
    if (typeof raw !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(raw)) throw DomainError.because(`invalid MADE action ${raw}`);
    return new MadeAction(raw);
  }
}
```

`src/domain/made/MadeActionPolicy.ts`:

```ts
import type { ToolName } from "../mcp/ToolName.ts";
import type { Phase } from "../session/Phase.ts";
import { PhaseToolSelection } from "../session/PhaseToolSelection.ts";
import { MadeActionClass } from "./MadeActionClass.ts";

// Tabla cerrada de S3a §1, por nombre de tool sin el prefijo `made_`.
const AUTO = new Set([
  "get_status", "discover_capabilities", "get_help", "list_contracts", "list_ceremony_instances", "get_ceremony_instance", "get_ceremony_transcript",
  "read_ceremony_events", "get_artifact", "list_artifacts", "read_artifact_chunk", "get_budget_report", "get_metrics", "explain_ceremony_draft",
  "validate_ceremony_draft", "diff_ceremony_definitions", "design_ceremony",
]);
const NEVER = new Set(["issue_authorization_grant", "revoke_authorization_grant", "approve_authorization_operation", "get_authorization_policy", "list_authorization_decisions"]);

// Qué puede conceder el host para una tool de MADE. Lo desconocido es confirm; lo que no es de
// MADE, never. La fase manda: nada se concede si la fase actual no expone la tool.
export class MadeActionPolicy {
  readonly #phases: PhaseToolSelection;
  private constructor(phases: PhaseToolSelection) { this.#phases = phases; }

  static of(phases: PhaseToolSelection): MadeActionPolicy { return new MadeActionPolicy(phases); }
  static standard(): MadeActionPolicy { return new MadeActionPolicy(PhaseToolSelection.standard()); }

  classify(tool: ToolName): MadeActionClass {
    if (!tool.hasPrefix("made_")) return MadeActionClass.NEVER;
    const action = tool.value.slice("made_".length);
    if (NEVER.has(action)) return MadeActionClass.NEVER;
    return AUTO.has(action) ? MadeActionClass.AUTO : MadeActionClass.CONFIRM;
  }

  // La clase si el host puede conceder la tool en esta fase; null si nunca o si la fase no la expone.
  admits(tool: ToolName, phase: Phase | null): MadeActionClass | null {
    const c = this.classify(tool);
    if (c.equals(MadeActionClass.NEVER) || phase === null || !this.#phases.exposes(phase, tool)) return null;
    return c;
  }
}
```

`src/domain/made/MadeScope.ts`:

```ts
import { CanonicalJson } from "../shared/CanonicalJson.ts";
import { DomainError } from "../shared/DomainError.ts";

// Campos de identidad de cada tipo de alcance de MADE 0.8.0 (esquema de made_issue_authorization_grant).
const FIELDS: Record<string, string[]> = {
  global: [], ceremony: ["ceremony_id"], ceremony_tree: ["root_id"], definition: ["name"], artifact: ["artifact_id"], council: ["council_id"], budget: ["account_id"],
};
const LABEL: Record<string, string> = { ceremony_tree: "ceremony tree" };
const identity = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);

// Alcance de una decisión o de un grant de MADE, con su forma exacta: tipo y nombre, versión o
// id. Nunca contenido. `key` identifica el alcance; `summary` es la versión legible.
export class MadeScope {
  readonly kind: string; readonly #fields: Record<string, string | null>;
  private constructor(kind: string, fields: Record<string, string | null>) { this.kind = kind; this.#fields = fields; }

  static readonly GLOBAL = new MadeScope("global", {});

  static parse(raw: unknown): MadeScope {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw DomainError.because("MADE scope must be an object");
    const o = raw as Record<string, unknown>;
    const kind = o.kind;
    if (typeof kind !== "string" || !(kind in FIELDS)) throw DomainError.because(`unknown MADE scope kind ${String(kind)}`);
    const fields: Record<string, string | null> = {};
    for (const f of FIELDS[kind]) {
      if (!identity(o[f])) throw DomainError.because(`MADE scope ${kind} needs ${f}`);
      fields[f] = o[f] as string;
    }
    if (kind === "definition") {
      if (o.version !== undefined && o.version !== null && !identity(o.version)) throw DomainError.because("MADE definition scope has an invalid version");
      fields.version = (o.version as string | null | undefined) ?? null;
    }
    return kind === "global" ? MadeScope.GLOBAL : new MadeScope(kind, fields);
  }

  // La forma de MADE, para emitir el grant y para los hechos.
  toJson(): Record<string, string | null> { return { kind: this.kind, ...this.#fields }; }
  get key(): string { return CanonicalJson.of(this.toJson()).text; }
  equals(o: MadeScope): boolean { return o.key === this.key; }

  summary(): string {
    if (this.kind === "global") return "global";
    if (this.kind === "definition") return `definition ${this.#fields.name}${this.#fields.version === null ? "" : ` v${this.#fields.version}`}`;
    return `${LABEL[this.kind] ?? this.kind} ${Object.values(this.#fields)[0]}`;
  }
}
```

`src/domain/made/MadeDecisionId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const DENIAL = /^authorization decision ([0-9a-f]{64}) denied the operation$/;

// Id de una decisión de autorización de MADE (sha256 en hex).
export class MadeDecisionId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): MadeDecisionId {
    if (typeof raw !== "string" || !/^[0-9a-f]{64}$/.test(raw)) throw DomainError.because("MADE decision id must be a lowercase sha256");
    return new MadeDecisionId(raw);
  }

  // La denegación de MADE 0.8.0 en modo embebido: negativa `refused` con este mensaje exacto.
  static fromDenial(message: string): MadeDecisionId | null {
    const m = typeof message === "string" ? DENIAL.exec(message) : null;
    return m === null ? null : new MadeDecisionId(m[1]);
  }

  // Cursor exclusivo que deja esta decisión la primera de la página: MADE ordena por id y
  // devuelve las de id mayor que el cursor. null para el id más pequeño (sin cursor).
  cursor(): string | null {
    const n = BigInt(`0x${this.value}`);
    return n === 0n ? null : (n - 1n).toString(16).padStart(64, "0");
  }
}
```

`src/domain/made/MadeDecision.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { MadeAction } from "./MadeAction.ts";
import { MadeDecisionId } from "./MadeDecisionId.ts";
import { MadeScope } from "./MadeScope.ts";

// Una decisión de made_list_authorization_decisions: sólo lo que el host necesita.
export class MadeDecision {
  readonly id: MadeDecisionId; readonly action: MadeAction; readonly scope: MadeScope; readonly #denied: boolean;
  private constructor(id: MadeDecisionId, action: MadeAction, scope: MadeScope, denied: boolean) { this.id = id; this.action = action; this.scope = scope; this.#denied = denied; }

  static parse(raw: unknown): MadeDecision {
    if (typeof raw !== "object" || raw === null) throw DomainError.because("MADE decision must be an object");
    const o = raw as Record<string, unknown>;
    return new MadeDecision(MadeDecisionId.of(o.decision_id as string), MadeAction.of(o.action as string), MadeScope.parse(o.scope), o.outcome === "deny");
  }

  denied(): boolean { return this.#denied; }
}
```

`src/domain/made/MadeGrantId.ts`:

```ts
import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { SessionId } from "../events/SessionId.ts";
import type { Timestamp } from "../events/Timestamp.ts";
import type { MadeAction } from "./MadeAction.ts";
import type { MadeScope } from "./MadeScope.ts";

const PREFIX = "pi-runtime-";

// Id de un grant emitido por el host. Determinista (S3a §2.4): sesión, acción, alcance e
// instante; reemitir el mismo grant con el mismo id es un no-op en MADE.
export class MadeGrantId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): MadeGrantId {
    if (typeof raw !== "string" || !/^pi-runtime-[0-9a-f]{32}$/.test(raw)) throw DomainError.because(`invalid host grant id ${raw}`);
    return new MadeGrantId(raw);
  }
  static derive(session: SessionId, action: MadeAction, scope: MadeScope, from: Timestamp): MadeGrantId {
    const digest = createHash("sha256").update(`${session.value}\n${action.value}\n${scope.key}\n${from.value}`).digest("hex");
    return new MadeGrantId(`${PREFIX}${digest.slice(0, 32)}`);
  }
}
```

`src/domain/made/MadeGrant.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { SessionId } from "../events/SessionId.ts";
import { Timestamp } from "../events/Timestamp.ts";
import { MadeAction } from "./MadeAction.ts";
import { MadeActionClass } from "./MadeActionClass.ts";
import { MadeGrantId } from "./MadeGrantId.ts";
import { MadeScope } from "./MadeScope.ts";
import type { TrustedHostId } from "./TrustedHostId.ts";

type Props = { id: MadeGrantId; session: SessionId; action: MadeAction; scope: MadeScope; actionClass: MadeActionClass; validFrom: Timestamp; validUntil: Timestamp };

// Un grant exacto del host (S3a §2): una acción, un alcance, el trusted host como emisor y
// beneficiario, sin delegación, con vigencia acotada por su clase.
export class MadeGrant {
  readonly id: MadeGrantId; readonly session: SessionId; readonly action: MadeAction; readonly scope: MadeScope;
  readonly actionClass: MadeActionClass; readonly validFrom: Timestamp; readonly validUntil: Timestamp;
  private constructor(p: Props) {
    this.id = p.id; this.session = p.session; this.action = p.action; this.scope = p.scope; this.actionClass = p.actionClass; this.validFrom = p.validFrom; this.validUntil = p.validUntil;
  }

  static issue(session: SessionId, action: MadeAction, scope: MadeScope, actionClass: MadeActionClass, now: Timestamp): MadeGrant {
    return new MadeGrant({ id: MadeGrantId.derive(session, action, scope, now), session, action, scope, actionClass, validFrom: now,
      validUntil: Timestamp.fromEpochMs(now.epochMs() + actionClass.lifetimeMs()) });
  }

  // Desde el payload de made.grant_issued; validFrom es el occurredAt del hecho.
  static fromFact(session: SessionId, payload: unknown, validFrom: Timestamp): MadeGrant {
    if (typeof payload !== "object" || payload === null) throw DomainError.because("grant payload must be an object");
    const p = payload as Record<string, unknown>;
    return new MadeGrant({ id: MadeGrantId.of(p.grantId as string), session, action: MadeAction.of(p.action as string), scope: MadeScope.parse(p.scope),
      actionClass: MadeActionClass.of(p.class as string), validFrom, validUntil: Timestamp.parse(p.validUntil as string) });
  }

  covers(action: MadeAction, scope: MadeScope, now: Timestamp): boolean { return this.action.equals(action) && this.scope.equals(scope) && !this.expired(now); }
  expired(now: Timestamp): boolean { return now.epochMs() >= this.validUntil.epochMs(); }

  // Argumentos de made_issue_authorization_grant (el dueño no pasa padre).
  issueArguments(grantee: TrustedHostId): Record<string, unknown> {
    return { grant_id: this.id.value, grantee_id: grantee.value, actions: [this.action.value], scope: this.scope.toJson(),
      valid_from: this.validFrom.value, valid_until: this.validUntil.value, delegation_depth: 0 };
  }

  // Payload de made.grant_issued (S3a §4).
  toFactPayload(): Record<string, unknown> {
    return { grantId: this.id.value, action: this.action.value, scope: this.scope.toJson(), validUntil: this.validUntil.value, class: this.actionClass.value };
  }
}
```

`src/domain/made/RevocationReason.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Por qué el host revoca un grant (S3a §4).
export class RevocationReason extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly SESSION_CLOSED = new RevocationReason("session_closed");
  static readonly EXPIRED_CLEANUP = new RevocationReason("expired_cleanup");
  static of(raw: string): RevocationReason {
    const found = [RevocationReason.SESSION_CLOSED, RevocationReason.EXPIRED_CLEANUP].find((r) => r.value === raw);
    if (typeof raw !== "string" || found === undefined) throw DomainError.because(`unknown revocation reason ${raw}`);
    return found;
  }
}
```

En `src/domain/session/PhaseToolSelection.ts`, sustituye:

```ts
  allowed(phase: Phase): ToolName[] { return [...(this.#byPhase.get(phase.value) ?? [])].sort().map((n) => ToolName.of(n)); }
  select(phase: Phase, registered: ToolName[], foreign: string[]): string[] {
```

por:

```ts
  allowed(phase: Phase): ToolName[] { return [...(this.#byPhase.get(phase.value) ?? [])].sort().map((n) => ToolName.of(n)); }
  // Si la fase expone esta tool (S3a: la fase manda sobre lo que el host concede).
  exposes(phase: Phase, tool: ToolName): boolean { return this.#byPhase.get(phase.value)?.has(tool.value) ?? false; }
  select(phase: Phase, registered: ToolName[], foreign: string[]): string[] {
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/domain/made/authorization.test.ts` y después `npm test`.

Expected: 7 tests nuevos en verde; `npm test` en verde (581 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/made/MadeActionClass.ts src/domain/made/MadeAction.ts src/domain/made/MadeActionPolicy.ts src/domain/made/MadeScope.ts src/domain/made/MadeDecisionId.ts src/domain/made/MadeDecision.ts src/domain/made/MadeGrantId.ts src/domain/made/MadeGrant.ts src/domain/made/RevocationReason.ts src/domain/session/PhaseToolSelection.ts tests/unit/domain/made/authorization.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): dominio de la autorización de MADE (clases, alcances, decisiones y grants)"
```

---

### Task 3: Confirmación — token de un solo uso ligado a la llamada exacta

§3: el host genera el token (16 bytes de entropía, por el puerto `EntropySource`), vale 2 minutos, una sola vez y sólo para la misma sesión, tool y argumentos (`CallDigest`, sha256 del JSON canónico; los argumentos no se guardan). `PendingConfirmations` guarda en memoria las pedidas y aún sin responder: cualquier presentación de un token lo consume, sirva o no; purga las caducadas y nunca guarda más de 64. `ConfirmationOutcome.refusal` es lo único que la extensión puede comunicar por sí misma (declined o no_ui): aceptar sólo se prueba reenviando la llamada con el token.

**Files:**
- Create: `src/domain/made/ConfirmationToken.ts`, `src/domain/made/CallDigest.ts`, `src/domain/made/ConfirmationOutcome.ts`, `src/domain/made/PendingConfirmation.ts`, `src/application/services/PendingConfirmations.ts`
- Test: `tests/unit/domain/made/confirmation.test.ts`, `tests/unit/application/services/PendingConfirmations.test.ts`

**Interfaces:**
- Consumes: `SessionId`, `ToolName`, `Timestamp`, `CanonicalJson`, `MadeAction`, `MadeScope` (Task 2), `Clock`, `EntropySource`, `ManualClock`.
- Produces:
  - `ConfirmationToken.of(raw)` (32 hex), `.fromEntropy(bytes: Uint8Array)` (16 bytes)
  - `CallDigest.of(session: SessionId, tool: ToolName, args: Record<string, unknown>)`
  - `ConfirmationOutcome.{ACCEPTED, DECLINED, NO_UI}`, `.of(raw)`, `.refusal(raw)` (rechaza `accepted`)
  - `PendingConfirmation.TTL_MS` (120 000), `.open(token, session, tool, digest, action, scope, now)`, campos `token`, `session`, `tool`, `digest`, `action`, `scope`, `expiresAt`; `#expired(now)`, `#matches(session, tool, digest, now)`, `#scopeSummary()`
  - `PendingConfirmations(entropy, clock)`: `#open(session, tool, digest, action, scope): PendingConfirmation`, `#redeem(token, session, tool, digest): PendingConfirmation | null`, `#settle(token, session): PendingConfirmation | null`, `#size()`

- [ ] **Step 1: Test que falla**

`tests/unit/domain/made/confirmation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { CallDigest } from "../../../../src/domain/made/CallDigest.ts";
import { ConfirmationOutcome } from "../../../../src/domain/made/ConfirmationOutcome.ts";
import { ConfirmationToken } from "../../../../src/domain/made/ConfirmationToken.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { PendingConfirmation } from "../../../../src/domain/made/PendingConfirmation.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const S1 = SessionId.of("s1"); const PUBLISH = ToolName.of("made_publish_ceremony_definition");

test("el token sale de 16 bytes de entropía y sólo acepta 32 hex", () => {
  const t = ConfirmationToken.fromEntropy(new Uint8Array(16).fill(171));
  assert.equal(t.value, "ab".repeat(16));
  assert.ok(ConfirmationToken.of("ab".repeat(16)).equals(t));
  assert.throws(() => ConfirmationToken.fromEntropy(new Uint8Array(8)), DomainError);
  for (const bad of ["", "AB".repeat(16), "ab".repeat(17), 5 as never]) assert.throws(() => ConfirmationToken.of(bad), DomainError);
});

test("la huella de la llamada depende de sesión, tool y argumentos, no del orden de las claves", () => {
  const a = CallDigest.of(S1, PUBLISH, { definition_yaml: "x", extra: 1 });
  assert.ok(a.equals(CallDigest.of(S1, PUBLISH, { extra: 1, definition_yaml: "x" })));
  assert.ok(!a.equals(CallDigest.of(S1, PUBLISH, { definition_yaml: "y", extra: 1 })));
  assert.ok(!a.equals(CallDigest.of(SessionId.of("s2"), PUBLISH, { definition_yaml: "x", extra: 1 })));
  assert.ok(!a.equals(CallDigest.of(S1, ToolName.of("made_validate_ceremony_draft"), { definition_yaml: "x", extra: 1 })));
  assert.match(a.value, /^[0-9a-f]{64}$/);
});

test("una confirmación pendiente vale 2 minutos y sólo para la misma llamada", () => {
  const now = Timestamp.fromEpochMs(1_000);
  const digest = CallDigest.of(S1, PUBLISH, { definition_yaml: "x" });
  const p = PendingConfirmation.open(ConfirmationToken.of("ab".repeat(16)), S1, PUBLISH, digest, MadeAction.of("publish_ceremony_definition"),
    MadeScope.parse({ kind: "definition", name: "d", version: "1.0" }), now);
  assert.equal(p.expiresAt.epochMs(), 1_000 + PendingConfirmation.TTL_MS);
  assert.equal(PendingConfirmation.TTL_MS, 120_000);
  assert.ok(p.matches(S1, PUBLISH, digest, now));
  assert.ok(!p.matches(S1, PUBLISH, CallDigest.of(S1, PUBLISH, { definition_yaml: "z" }), now));
  assert.ok(!p.matches(SessionId.of("s2"), PUBLISH, digest, now));
  assert.ok(!p.matches(S1, PUBLISH, digest, p.expiresAt));
  assert.equal(p.scopeSummary(), "definition d v1.0");
});

test("resultados de confirmación: la extensión sólo puede comunicar declined o no_ui", () => {
  assert.equal(ConfirmationOutcome.of("accepted"), ConfirmationOutcome.ACCEPTED);
  assert.equal(ConfirmationOutcome.refusal("declined"), ConfirmationOutcome.DECLINED);
  assert.equal(ConfirmationOutcome.refusal("no_ui"), ConfirmationOutcome.NO_UI);
  assert.throws(() => ConfirmationOutcome.refusal("accepted"), DomainError);
  assert.throws(() => ConfirmationOutcome.of("maybe"), DomainError);
});
```

`tests/unit/application/services/PendingConfirmations.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { CallDigest } from "../../../../src/domain/made/CallDigest.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ManualClock } from "../../../support/ManualClock.ts";

const S1 = SessionId.of("s1"); const PUBLISH = ToolName.of("made_publish_ceremony_definition");
const ACTION = MadeAction.of("publish_ceremony_definition"); const SCOPE = MadeScope.parse({ kind: "definition", name: "d", version: "1.0" });
let counter = 0;
const entropy = { bytes: (n: number) => new Uint8Array(n).map((_, i) => (i === 0 ? ++counter : 7)) };
const digest = (args: Record<string, unknown>) => CallDigest.of(S1, PUBLISH, args);

test("un token se redime una sola vez, con la misma llamada y antes de 2 minutos", () => {
  const clock = new ManualClock(1_000); const pending = new PendingConfirmations(entropy, clock);
  const a = pending.open(S1, PUBLISH, digest({ y: 1 }), ACTION, SCOPE);
  assert.ok(pending.redeem(a.token, S1, PUBLISH, digest({ y: 1 })) === a);
  assert.equal(pending.redeem(a.token, S1, PUBLISH, digest({ y: 1 })), null, "un solo uso");
  const b = pending.open(S1, PUBLISH, digest({ y: 1 }), ACTION, SCOPE);
  assert.equal(pending.redeem(b.token, S1, PUBLISH, digest({ y: 2 })), null, "otros argumentos");
  assert.equal(pending.redeem(b.token, S1, PUBLISH, digest({ y: 1 })), null, "presentarlo mal lo consume");
  const c = pending.open(S1, PUBLISH, digest({ y: 1 }), ACTION, SCOPE);
  clock.ms += 120_000;
  assert.equal(pending.redeem(c.token, S1, PUBLISH, digest({ y: 1 })), null, "caducado");
});

test("un rechazo se asienta sobre la confirmación de su sesión y la consume", () => {
  const clock = new ManualClock(1_000); const pending = new PendingConfirmations(entropy, clock);
  const a = pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  assert.equal(pending.settle(a.token, SessionId.of("s2")), null);
  const b = pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  assert.ok(pending.settle(b.token, S1) === b);
  assert.equal(pending.settle(b.token, S1), null);
  assert.equal(pending.size(), 0);
});

test("las caducadas se purgan y nunca hay más de 64 pendientes", () => {
  const clock = new ManualClock(1_000); const pending = new PendingConfirmations(entropy, clock);
  const first = pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  for (let i = 0; i < 70; i++) pending.open(S1, PUBLISH, digest({ i }), ACTION, SCOPE);
  assert.equal(pending.size(), 64);
  assert.equal(pending.redeem(first.token, S1, PUBLISH, digest({})), null, "la más antigua salió");
  clock.ms += 120_000;
  pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  assert.equal(pending.size(), 1);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/domain/made/confirmation.test.ts tests/unit/application/services/PendingConfirmations.test.ts`

Expected: FAIL por `Cannot find module …/src/domain/made/CallDigest.ts` y `…/src/application/services/PendingConfirmations.ts`.

- [ ] **Step 3: Implementar**

`src/domain/made/ConfirmationToken.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Token de confirmación (S3a §3): lo genera el host con 16 bytes de entropía y la extensión sólo lo reenvía.
export class ConfirmationToken extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ConfirmationToken {
    if (typeof raw !== "string" || !/^[0-9a-f]{32}$/.test(raw)) throw DomainError.because("invalid confirmation token");
    return new ConfirmationToken(raw);
  }
  static fromEntropy(bytes: Uint8Array): ConfirmationToken {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw DomainError.because("a confirmation token needs exactly 16 bytes of entropy");
    return new ConfirmationToken([...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
  }
}
```

`src/domain/made/CallDigest.ts`:

```ts
import { createHash } from "node:crypto";
import type { SessionId } from "../events/SessionId.ts";
import type { ToolName } from "../mcp/ToolName.ts";
import { CanonicalJson } from "../shared/CanonicalJson.ts";
import { ValueObject } from "../shared/ValueObject.ts";

// Huella de una llamada exacta (sesión, tool y argumentos en JSON canónico): liga un token de
// confirmación a la llamada que lo pidió sin guardar los argumentos.
export class CallDigest extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(session: SessionId, tool: ToolName, args: Record<string, unknown>): CallDigest {
    const text = CanonicalJson.of({ session: session.value, tool: tool.value, args }).text;
    return new CallDigest(createHash("sha256").update(text).digest("hex"));
  }
}
```

`src/domain/made/ConfirmationOutcome.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Qué pasó con una confirmación pedida (S3a §4, hecho made.confirmation).
export class ConfirmationOutcome extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly ACCEPTED = new ConfirmationOutcome("accepted");
  static readonly DECLINED = new ConfirmationOutcome("declined");
  static readonly NO_UI = new ConfirmationOutcome("no_ui");
  static of(raw: string): ConfirmationOutcome {
    const found = [ConfirmationOutcome.ACCEPTED, ConfirmationOutcome.DECLINED, ConfirmationOutcome.NO_UI].find((o) => o.value === raw);
    if (typeof raw !== "string" || found === undefined) throw DomainError.because(`unknown confirmation outcome ${raw}`);
    return found;
  }
  // Lo que la extensión puede comunicar por sí misma: aceptar sólo se prueba reenviando el token.
  static refusal(raw: string): ConfirmationOutcome {
    const o = ConfirmationOutcome.of(raw);
    if (o.equals(ConfirmationOutcome.ACCEPTED)) throw DomainError.because("an accepted confirmation is proved by resending the call with its token");
    return o;
  }
}
```

`src/domain/made/PendingConfirmation.ts`:

```ts
import type { SessionId } from "../events/SessionId.ts";
import { Timestamp } from "../events/Timestamp.ts";
import type { ToolName } from "../mcp/ToolName.ts";
import type { CallDigest } from "./CallDigest.ts";
import type { ConfirmationToken } from "./ConfirmationToken.ts";
import type { MadeAction } from "./MadeAction.ts";
import type { MadeScope } from "./MadeScope.ts";

const TTL_MS = 120_000;

type Props = { token: ConfirmationToken; session: SessionId; tool: ToolName; digest: CallDigest; action: MadeAction; scope: MadeScope; expiresAt: Timestamp };

// Una confirmación pedida y aún sin responder (S3a §3): un solo uso, 2 minutos, ligada a la
// llamada exacta. Lleva la acción y el alcance de la decisión que la originó.
export class PendingConfirmation {
  readonly token: ConfirmationToken; readonly session: SessionId; readonly tool: ToolName; readonly digest: CallDigest;
  readonly action: MadeAction; readonly scope: MadeScope; readonly expiresAt: Timestamp;
  private constructor(p: Props) { this.token = p.token; this.session = p.session; this.tool = p.tool; this.digest = p.digest; this.action = p.action; this.scope = p.scope; this.expiresAt = p.expiresAt; }

  static readonly TTL_MS = TTL_MS;

  static open(token: ConfirmationToken, session: SessionId, tool: ToolName, digest: CallDigest, action: MadeAction, scope: MadeScope, now: Timestamp): PendingConfirmation {
    return new PendingConfirmation({ token, session, tool, digest, action, scope, expiresAt: Timestamp.fromEpochMs(now.epochMs() + TTL_MS) });
  }

  expired(now: Timestamp): boolean { return now.epochMs() >= this.expiresAt.epochMs(); }
  // La llamada que la redime es la misma que la pidió, y a tiempo.
  matches(session: SessionId, tool: ToolName, digest: CallDigest, now: Timestamp): boolean {
    return this.session.equals(session) && this.tool.equals(tool) && this.digest.equals(digest) && !this.expired(now);
  }
  scopeSummary(): string { return this.scope.summary(); }
}
```

`src/application/services/PendingConfirmations.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import type { CallDigest } from "../../domain/made/CallDigest.ts";
import { ConfirmationToken } from "../../domain/made/ConfirmationToken.ts";
import type { MadeAction } from "../../domain/made/MadeAction.ts";
import type { MadeScope } from "../../domain/made/MadeScope.ts";
import { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EntropySource } from "../ports/EntropySource.ts";

const MAX_PENDING = 64;

// Confirmaciones pedidas por el host y aún sin responder, en memoria (un host que muere las
// pierde, y la extensión recibe otra al repetir la llamada). Cada token se consume la primera
// vez que alguien lo presenta, sirva o no: un solo uso de verdad.
export class PendingConfirmations {
  readonly #entropy: EntropySource; readonly #clock: Clock; readonly #pending = new Map<string, PendingConfirmation>();
  constructor(entropy: EntropySource, clock: Clock) { this.#entropy = entropy; this.#clock = clock; }

  open(session: SessionId, tool: ToolName, digest: CallDigest, action: MadeAction, scope: MadeScope): PendingConfirmation {
    const now = this.#clock.now();
    for (const [k, p] of this.#pending) if (p.expired(now)) this.#pending.delete(k);
    while (this.#pending.size >= MAX_PENDING) this.#pending.delete(this.#pending.keys().next().value!);
    const pending = PendingConfirmation.open(ConfirmationToken.fromEntropy(this.#entropy.bytes(16)), session, tool, digest, action, scope, now);
    this.#pending.set(pending.token.value, pending);
    return pending;
  }

  // La llamada repetida con su token: la confirmación si es la misma llamada y a tiempo; si no, null.
  redeem(token: ConfirmationToken, session: SessionId, tool: ToolName, digest: CallDigest): PendingConfirmation | null {
    const p = this.#take(token);
    return p !== null && p.matches(session, tool, digest, this.#clock.now()) ? p : null;
  }

  // Un rechazo o una sesión sin UI: la confirmación de esa sesión, aún vigente, o null.
  settle(token: ConfirmationToken, session: SessionId): PendingConfirmation | null {
    const p = this.#take(token);
    return p !== null && p.session.equals(session) && !p.expired(this.#clock.now()) ? p : null;
  }

  size(): number { return this.#pending.size; }

  #take(token: ConfirmationToken): PendingConfirmation | null {
    const p = this.#pending.get(token.value) ?? null;
    this.#pending.delete(token.value);
    return p;
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/domain/made/confirmation.test.ts tests/unit/application/services/PendingConfirmations.test.ts` y después `npm test`.

Expected: 7 tests nuevos en verde; `npm test` en verde (588 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/made/ConfirmationToken.ts src/domain/made/CallDigest.ts src/domain/made/ConfirmationOutcome.ts src/domain/made/PendingConfirmation.ts src/application/services/PendingConfirmations.ts tests/unit/domain/made/confirmation.test.ts tests/unit/application/services/PendingConfirmations.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): tokens de confirmación de un solo uso ligados a la llamada"
```

---

### Task 4: Hechos de auditoría y libro de grants del host

Los tres tipos nuevos de §4 entran en `EventType` (`made.grant_issued` y `made.confirmation` de sesión, `made.grant_revoked` del host) y `MadeFactFactory` los construye con ids deterministas por grant o por token, así que registrar dos veces lo mismo es idempotente. `made.grant_revoked` va siempre al stream del host: al cerrarse la sesión, `SessionAggregate` ya no admite hechos en su stream. No entran en la lista de `FactMapper`: Pi no puede enviarlos por `record`, sólo el host los registra.

`MadeGrantLedger` reconstruye del log los grants del host: los emitidos, los revocados, y el cierre y la última actividad (por `recordedAt`) de sus sesiones. De ahí salen los vigentes de una sesión, el estado de cada grant (`active`, `expired`, `revoked`), las confirmaciones de la sesión y los huérfanos: sin revocar y con la sesión cerrada (`session_closed`), abandonada 24 h como en O1 y L1, o con el grant ya caducado (`expired_cleanup`).

Por último, las ventanas de L1 (`SelectionWindows`) dejan de tratar como hechos de Pi la auditoría de MADE y los tipos opacos de la tarea 1: el host registra `made.*` en el acto, mientras los hechos de Pi de la ventana anterior aún pueden venir por su cola, así que un `made.grant_issued` cerraría antes de tiempo una ventana de decisión.

**Files:**
- Create: `src/application/services/MadeFactFactory.ts`, `src/application/services/MadeGrantLedger.ts`
- Modify: `src/domain/events/EventType.ts`, `src/application/services/SelectionWindows.ts`
- Test: `tests/unit/application/services/MadeGrantLedger.test.ts`, `tests/unit/application/services/SelectionWindowsAudit.test.ts`

**Interfaces:**
- Consumes: `EventType`, `Fact`, `EventId.derive`, `EventAbout`, `StreamId`, `TypeVersion.V1`, `CanonicalJson`, `MadeGrant`, `MadeGrantId`, `RevocationReason` (Task 2), `PendingConfirmation`, `ConfirmationOutcome` (Task 3), `EventStore`, `GlobalPosition`, `Clock`, `RecordFact`.
- Produces:
  - `EventType` conoce `made.grant_issued`, `made.confirmation` (sesión) y `made.grant_revoked` (host); `EventType#madeAudit(): boolean`
  - `MadeFactFactory(clock: Clock, actor: Actor)`: `#grantIssued(grant: MadeGrant): Fact` (id `session:<sid>:made.grant_issued:grant.<grantId>`, occurredAt = `validFrom`), `#grantRevoked(grant: MadeGrantId, session: SessionId, reason: RevocationReason): Fact` (stream `host`, id `host:made.grant_revoked:revoke.<grantId>`), `#confirmation(pending: PendingConfirmation, outcome: ConfirmationOutcome): Fact` (id `…:made.confirmation:confirm.<token>`)
  - `MadeGrantLedger.of(records: Iterable<EventRecord>)`, `.read(events: EventStore)` (todo el log, páginas de 1000), `.forSession(events, session)` (su stream y el del host); `#grants(): MadeGrant[]` (por emisión), `#state(grant, now): "active" | "expired" | "revoked"`, `#live(session, now): MadeGrant[]`, `#orphans(now): {grant: MadeGrant; reason: RevocationReason}[]`, `#confirmations(session): number`
  - `SelectionWindows#visit` ignora `made.*` y tipos opacos

- [ ] **Step 1: Test que falla**

`tests/unit/application/services/MadeGrantLedger.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeGrantLedger } from "../../../../src/application/services/MadeGrantLedger.ts";
import { FactMapper } from "../../../../src/application/mappers/FactMapper.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { CallDigest } from "../../../../src/domain/made/CallDigest.ts";
import { ConfirmationOutcome } from "../../../../src/domain/made/ConfirmationOutcome.ts";
import { ConfirmationToken } from "../../../../src/domain/made/ConfirmationToken.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../../src/domain/made/MadeActionClass.ts";
import { MadeGrant } from "../../../../src/domain/made/MadeGrant.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { PendingConfirmation } from "../../../../src/domain/made/PendingConfirmation.ts";
import { RevocationReason } from "../../../../src/domain/made/RevocationReason.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const HOUR = 3_600_000;
const HOST = Actor.of("host", "host:1");
const DEF = MadeScope.parse({ kind: "definition", name: "d", version: "1.0" });
const at = (ms: number) => Timestamp.fromEpochMs(ms);
const sid = (s: string) => SessionId.of(s);
const opened = (s: string, ms: number) => fact("session.opened", `o.${ms}`, { reason: "startup" }, StreamId.session(sid(s)), ms);
const closed = (s: string, ms: number) => fact("session.closed", `c.${ms}`, { reason: "quit" }, StreamId.session(sid(s)), ms);

function log(clock: ManualClock) {
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock); const facts = new MadeFactFactory(clock, HOST);
  const grant = (s: string, action: string, scope: MadeScope, c: MadeActionClass) => {
    const g = MadeGrant.issue(sid(s), MadeAction.of(action), scope, c, clock.now());
    record.execute(facts.grantIssued(g)); return g;
  };
  return { events, record, facts, grant };
}

test("los hechos de S3a son v1, van a su stream y sólo llevan metadatos", () => {
  const clock = new ManualClock(10_000); const { facts } = log(clock);
  assert.equal(EventType.of("made.grant_issued").belongsToSessions(), true);
  assert.equal(EventType.of("made.confirmation").belongsToSessions(), true);
  assert.equal(EventType.of("made.grant_revoked").belongsToSessions(), false);
  assert.equal(EventType.of("made.grant_issued").madeAudit(), true);
  assert.equal(EventType.of("tools.selected").madeAudit(), false);
  const g = MadeGrant.issue(sid("s1"), MadeAction.of("validate_ceremony_draft"), DEF, MadeActionClass.AUTO, clock.now());
  const issued = facts.grantIssued(g);
  assert.equal(issued.stream.value, "session:s1");
  assert.equal(issued.id.value, `session:s1:made.grant_issued:grant.${g.id.value}`);
  assert.equal(issued.typeVersion.value, 1);
  assert.deepEqual(issued.payload.toValue(), { grantId: g.id.value, action: "validate_ceremony_draft", scope: { kind: "definition", name: "d", version: "1.0" }, validUntil: g.validUntil.value, class: "auto" });
  const revoked = facts.grantRevoked(g.id, sid("s1"), RevocationReason.SESSION_CLOSED);
  assert.equal(revoked.stream.value, "host");
  assert.deepEqual(revoked.payload.toValue(), { grantId: g.id.value, session: "s1", reason: "session_closed" });
  const pending = PendingConfirmation.open(ConfirmationToken.of("ab".repeat(16)), sid("s1"), ToolName.of("made_publish_ceremony_definition"),
    CallDigest.of(sid("s1"), ToolName.of("made_publish_ceremony_definition"), { definition_yaml: "secret yaml" }), MadeAction.of("publish_ceremony_definition"), DEF, clock.now());
  const confirmed = facts.confirmation(pending, ConfirmationOutcome.DECLINED);
  assert.equal(confirmed.id.value, `session:s1:made.confirmation:confirm.${"ab".repeat(16)}`);
  assert.deepEqual(confirmed.payload.toValue(), { action: "publish_ceremony_definition", scopeSummary: "definition d v1.0", outcome: "declined" });
  assert.ok(!confirmed.payload.text.includes("secret"));
  // Sólo el host los registra: Pi no puede enviarlos por `record`.
  for (const type of ["made.grant_issued", "made.confirmation"]) {
    assert.throws(() => new FactMapper().toDomain({ stream: "session", sessionId: "s1", type, typeVersion: 1, about: "x", occurredAtMs: 1, actor: { kind: "agent", id: "pi:1" }, payload: {} }), DomainError, type);
  }
});

test("un grant sólo se registra con la sesión abierta", () => {
  const clock = new ManualClock(10_000); const { grant } = log(clock);
  assert.throws(() => grant("s1", "get_status", MadeScope.GLOBAL, MadeActionClass.AUTO), DomainError);
});

test("el libro: vigentes por sesión, estados, confirmaciones y huérfanos por cierre, abandono o caducidad", () => {
  const clock = new ManualClock(10_000); const { events, record, facts, grant } = log(clock);
  for (const s of ["open", "closed", "idle"]) record.execute(opened(s, 10_000));
  const a = grant("open", "validate_ceremony_draft", DEF, MadeActionClass.AUTO);
  const b = grant("closed", "list_contracts", MadeScope.GLOBAL, MadeActionClass.AUTO);
  const c = grant("idle", "design_ceremony", MadeScope.GLOBAL, MadeActionClass.AUTO);
  clock.ms += 1;
  const d = grant("open", "publish_ceremony_definition", DEF, MadeActionClass.CONFIRM);
  const e = grant("closed", "explain_ceremony_draft", DEF, MadeActionClass.AUTO);
  record.execute(facts.grantRevoked(e.id, sid("closed"), RevocationReason.SESSION_CLOSED));
  record.execute(closed("closed", 10_002));
  const pending = PendingConfirmation.open(ConfirmationToken.of("cd".repeat(16)), sid("open"), ToolName.of("made_publish_ceremony_definition"),
    CallDigest.of(sid("open"), ToolName.of("made_publish_ceremony_definition"), {}), MadeAction.of("publish_ceremony_definition"), DEF, clock.now());
  record.execute(facts.confirmation(pending, ConfirmationOutcome.ACCEPTED));

  const ledger = MadeGrantLedger.read(events);
  const ids = (gs: MadeGrant[]) => gs.map((g) => g.id.value).sort();
  assert.deepEqual(ids(ledger.grants()), ids([a, b, c, d, e]));
  assert.deepEqual(ids(ledger.grants().slice(3)), ids([d, e]), "por instante de emisión");
  assert.equal(ledger.state(e, clock.now()), "revoked");
  assert.equal(ledger.state(a, clock.now()), "active");
  assert.deepEqual(ledger.live(sid("open"), clock.now()).map((g) => g.id.value).sort(), [a.id.value, d.id.value].sort());
  assert.equal(ledger.confirmations(sid("open")), 1);
  assert.equal(ledger.confirmations(sid("idle")), 0);
  assert.deepEqual(ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]), [[b.id.value, "session_closed"]]);

  clock.ms += 5 * 60_000; // el grant confirm de 5 min caduca: huérfano por limpieza aunque la sesión siga abierta
  assert.equal(ledger.state(d, clock.now()), "expired");
  assert.deepEqual(ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]).sort(), [[b.id.value, "session_closed"], [d.id.value, "expired_cleanup"]].sort());

  clock.ms = 10_000 + 24 * HOUR; // 24 h sin hechos: las sesiones abiertas están abandonadas
  const all = ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]).sort();
  assert.deepEqual(all, [[a.id.value, "expired_cleanup"], [b.id.value, "session_closed"], [c.id.value, "expired_cleanup"], [d.id.value, "expired_cleanup"]].sort());

  const one = MadeGrantLedger.forSession(events, sid("closed"));
  assert.deepEqual(one.grants().map((g) => g.id.value).sort(), [b.id.value, e.id.value].sort());
  assert.equal(one.state(e, clock.now()), "revoked");
});

test("un payload inesperado se ignora y una sesión reabierta deja de estar cerrada", () => {
  const clock = new ManualClock(10_000); const { events, record, grant } = log(clock);
  record.execute(opened("s1", 10_000));
  record.execute(fact("made.grant_issued", "grant.bad", { grantId: "nope" }, StreamId.session(sid("s1")), 10_000));
  const g = grant("s1", "get_status", MadeScope.GLOBAL, MadeActionClass.AUTO);
  record.execute(closed("s1", 10_001));
  record.execute(opened("s1", 10_002));
  const ledger = MadeGrantLedger.read(events);
  assert.deepEqual(ledger.grants().map((x) => x.id.value), [g.id.value]);
  assert.deepEqual(ledger.orphans(clock.now()), []);
});
```

`tests/unit/application/services/SelectionWindowsAudit.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectionState } from "../../../../src/application/services/ProjectionState.ts";
import { SelectionWindows } from "../../../../src/application/services/SelectionWindows.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { StoredEvent } from "../../../../src/domain/events/StoredEvent.ts";
import { ContinuationSealer } from "../../../../src/domain/events/ContinuationSealer.ts";
import { AT, fact } from "../../../support/recordFixtures.ts";

// La auditoría de MADE la registra el host en el acto, mientras los hechos de Pi de la ventana
// anterior aún pueden venir por su cola: no debe cerrar ventanas ni atribuirse a ellas.
test("un hecho de auditoría de MADE ni cierra ni se atribuye a una ventana de L1; uno de Pi sí", () => {
  const records = ContinuationSealer.seal(null, [
    fact("session.opened", "o", {}, undefined, 500),
    fact("tools.selected", "d1", {}, undefined, 1_000),
    fact("tools.selected", "d2", {}, undefined, 2_000),
    fact("made.grant_issued", "grant.x", {}, undefined, 3_000),
    fact("made.confirmation", "confirm.x", {}, undefined, 3_000),
    fact("tool.completed", "t1", {}, undefined, 3_000),
  ], AT);
  const closed: number[] = []; const attributed: string[] = [];
  const windows = new SelectionWindows<{ atMs: number }>("w", (_s, w) => closed.push(w.atMs));
  const state = new ProjectionState(new Map());
  records.forEach((r, i) => {
    const opened = r.type.value === "tools.selected" ? { atMs: r.occurredAt.epochMs() } : null;
    windows.visit(state, StoredEvent.of(GlobalPosition.of(i + 1), r), opened, () => attributed.push(r.type.value));
    if (r.type.value === "made.confirmation") assert.deepEqual(closed, [], "la auditoría no cerró la primera ventana");
  });
  assert.deepEqual(closed, [1_000]);
  assert.deepEqual(attributed, ["tool.completed"]);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/services/MadeGrantLedger.test.ts tests/unit/application/services/SelectionWindowsAudit.test.ts`

Expected: FAIL por `Cannot find module …/src/application/services/MadeFactFactory.ts` y, en el de las ventanas, `unknown event type "made.grant_issued"`.

- [ ] **Step 3: Implementar**

En `src/domain/events/EventType.ts`, sustituye:

```ts

const SESSION = ["session.opened", "session.closed", "phase.changed", "turn.completed", "tool.started", "tool.completed", "model.selected", "context.compacted", "tools.selected"];
const HOST = ["host.started", "host.stopped", "server.started", "server.exited", "learning.mode_changed"];
// Forma de cualquier tipo de hecho, conocido o de una versión futura: `familia.nombre`.
```

por:

```ts

const SESSION = ["session.opened", "session.closed", "phase.changed", "turn.completed", "tool.started", "tool.completed", "model.selected", "context.compacted", "tools.selected",
  "made.grant_issued", "made.confirmation"];
const HOST = ["host.started", "host.stopped", "server.started", "server.exited", "learning.mode_changed", "made.grant_revoked"];
// Forma de cualquier tipo de hecho, conocido o de una versión futura: `familia.nombre`.
```

En `src/domain/events/EventType.ts`, sustituye:

```ts
  known(): boolean { return this.#known; }
  belongsToSessions(): boolean { return SESSION.includes(this.value); }
```

por:

```ts
  known(): boolean { return this.#known; }
  // Auditoría de la autorización de MADE (S3a §4): la registra el host, nunca Pi.
  madeAudit(): boolean { return this.value.startsWith("made."); }
  belongsToSessions(): boolean { return SESSION.includes(this.value); }
```

En `src/application/services/SelectionWindows.ts`, sustituye:

```ts
    }
    if (r.stream.isSession()) {
      const stream = r.stream.value; const at = r.occurredAt.epochMs();
```

por:

```ts
    }
    // La auditoría de MADE (la registra el host en el acto) y los tipos que esta versión no conoce
    // no son hechos de Pi: ni se atribuyen a una ventana ni cierran las anteriores.
    if (r.stream.isSession() && r.type.known() && !r.type.madeAudit()) {
      const stream = r.stream.value; const at = r.occurredAt.epochMs();
```

`src/application/services/MadeFactFactory.ts`:

```ts
import type { Actor } from "../../domain/events/Actor.ts";
import { EventAbout } from "../../domain/events/EventAbout.ts";
import { EventId } from "../../domain/events/EventId.ts";
import { EventType } from "../../domain/events/EventType.ts";
import { Fact } from "../../domain/events/Fact.ts";
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { TypeVersion } from "../../domain/events/TypeVersion.ts";
import type { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeGrantId } from "../../domain/made/MadeGrantId.ts";
import type { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import type { RevocationReason } from "../../domain/made/RevocationReason.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import type { Clock } from "../ports/Clock.ts";

const ISSUED = EventType.of("made.grant_issued");
const REVOKED = EventType.of("made.grant_revoked");
const CONFIRMATION = EventType.of("made.confirmation");

// Hechos de auditoría de S3a §4, todos v1. Sólo nombres de acción, alcances de MADE (tipo y
// nombre, versión o id), ids de grant y sesión, instantes y resultados; nunca argumentos.
// Los ids son deterministas por grant o por token: registrar dos veces lo mismo es idempotente.
export class MadeFactFactory {
  readonly #clock: Clock; readonly #actor: Actor;
  constructor(clock: Clock, actor: Actor) { this.#clock = clock; this.#actor = actor; }

  grantIssued(grant: MadeGrant): Fact {
    const stream = StreamId.session(grant.session);
    return Fact.of({ id: EventId.derive(stream, ISSUED, EventAbout.of(`grant.${grant.id.value}`)), stream, type: ISSUED, typeVersion: TypeVersion.V1,
      occurredAt: grant.validFrom, actor: this.#actor, payload: CanonicalJson.of(grant.toFactPayload()) });
  }

  // En el stream del host: la sesión puede estar ya cerrada (session.closed no admite más hechos).
  grantRevoked(grant: MadeGrantId, session: SessionId, reason: RevocationReason): Fact {
    return Fact.of({ id: EventId.derive(StreamId.HOST, REVOKED, EventAbout.of(`revoke.${grant.value}`)), stream: StreamId.HOST, type: REVOKED, typeVersion: TypeVersion.V1,
      occurredAt: this.#clock.now(), actor: this.#actor, payload: CanonicalJson.of({ grantId: grant.value, session: session.value, reason: reason.value }) });
  }

  confirmation(pending: PendingConfirmation, outcome: ConfirmationOutcome): Fact {
    const stream = StreamId.session(pending.session);
    return Fact.of({ id: EventId.derive(stream, CONFIRMATION, EventAbout.of(`confirm.${pending.token.value}`)), stream, type: CONFIRMATION, typeVersion: TypeVersion.V1,
      occurredAt: this.#clock.now(), actor: this.#actor, payload: CanonicalJson.of({ action: pending.action.value, scopeSummary: pending.scopeSummary(), outcome: outcome.value }) });
  }
}
```

`src/application/services/MadeGrantLedger.ts`:

```ts
import type { EventRecord } from "../../domain/events/EventRecord.ts";
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import { MadeGrant } from "../../domain/made/MadeGrant.ts";
import { RevocationReason } from "../../domain/made/RevocationReason.ts";
import type { EventStore } from "../ports/EventStore.ts";

// Como en O1 y L1: una sesión sin hechos durante 24 h está abandonada.
const ABANDONED_AFTER_MS = 24 * 3_600_000;
const PAGE = 1_000;

type SessionMark = { closed: boolean; lastMs: number };
type GrantState = "active" | "expired" | "revoked";

// Los grants que el host registró en el log (S3a §4), reconstruidos de sus hechos: emitidos
// (sesión), revocados (host), y el cierre y la última actividad de sus sesiones. Un payload
// inesperado se ignora: el log nunca rompe la lectura.
export class MadeGrantLedger {
  readonly #grants = new Map<string, MadeGrant>(); readonly #revoked = new Set<string>();
  readonly #sessions = new Map<string, SessionMark>(); readonly #confirmations = new Map<string, number>();
  private constructor() {}

  static of(records: Iterable<EventRecord>): MadeGrantLedger {
    const ledger = new MadeGrantLedger();
    for (const r of records) ledger.#visit(r);
    return ledger;
  }

  // Todo el log, por páginas.
  static read(events: EventStore): MadeGrantLedger {
    const ledger = new MadeGrantLedger();
    let after = GlobalPosition.START;
    for (;;) {
      const page = events.readAll(after, PAGE);
      if (page.length === 0) return ledger;
      for (const e of page) ledger.#visit(e.record);
      after = page.at(-1)!.position;
    }
  }

  // Sólo lo que hace falta para una sesión: su stream y las revocaciones del host.
  static forSession(events: EventStore, session: SessionId): MadeGrantLedger {
    return MadeGrantLedger.of([...events.readStream(StreamId.session(session)), ...events.readStream(StreamId.HOST)]);
  }

  #visit(r: EventRecord): void {
    const p = r.payload.toValue() as Record<string, unknown> | null;
    if (r.stream.isSession()) {
      const sid = r.stream.sessionId().value;
      const mark = this.#sessions.get(sid) ?? { closed: false, lastMs: 0 };
      mark.lastMs = Math.max(mark.lastMs, r.recordedAt.epochMs());
      if (r.type.value === "session.opened") mark.closed = false;
      if (r.type.value === "session.closed") mark.closed = true;
      this.#sessions.set(sid, mark);
      if (r.type.value === "made.grant_issued") {
        try { const g = MadeGrant.fromFact(r.stream.sessionId(), p, r.occurredAt); this.#grants.set(g.id.value, g); } catch { /* payload inesperado */ }
      }
      if (r.type.value === "made.confirmation") this.#confirmations.set(sid, (this.#confirmations.get(sid) ?? 0) + 1);
      return;
    }
    if (r.type.value === "made.grant_revoked" && typeof p?.grantId === "string") this.#revoked.add(p.grantId);
  }

  state(grant: MadeGrant, now: Timestamp): GrantState {
    if (this.#revoked.has(grant.id.value)) return "revoked";
    return grant.expired(now) ? "expired" : "active";
  }

  // Todos los grants del host, por instante de emisión.
  grants(): MadeGrant[] { return [...this.#grants.values()].sort((a, b) => a.validFrom.epochMs() - b.validFrom.epochMs() || a.id.value.localeCompare(b.id.value)); }

  // Los vigentes de una sesión: los que el cierre debe revocar.
  live(session: SessionId, now: Timestamp): MadeGrant[] { return this.grants().filter((g) => g.session.equals(session) && this.state(g, now) === "active"); }

  // Sin revocar y con la sesión cerrada (session_closed), abandonada o el grant caducado (expired_cleanup).
  orphans(now: Timestamp): { grant: MadeGrant; reason: RevocationReason }[] {
    const out: { grant: MadeGrant; reason: RevocationReason }[] = [];
    for (const g of this.grants()) {
      if (this.#revoked.has(g.id.value)) continue;
      const mark = this.#sessions.get(g.session.value);
      if (mark?.closed) out.push({ grant: g, reason: RevocationReason.SESSION_CLOSED });
      else if (mark === undefined || now.epochMs() >= mark.lastMs + ABANDONED_AFTER_MS || g.expired(now)) out.push({ grant: g, reason: RevocationReason.EXPIRED_CLEANUP });
    }
    return out;
  }

  confirmations(session: SessionId): number { return this.#confirmations.get(session.value) ?? 0; }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/services/MadeGrantLedger.test.ts tests/unit/application/services/SelectionWindowsAudit.test.ts` y después `npm test`.

Expected: 5 tests nuevos en verde; `npm test` en verde (593 tests): ningún test de L1 cambia, porque ningún log anterior tiene hechos `made.*`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/events/EventType.ts src/application/services/SelectionWindows.ts src/application/services/MadeFactFactory.ts src/application/services/MadeGrantLedger.ts tests/unit/application/services/MadeGrantLedger.test.ts tests/unit/application/services/SelectionWindowsAudit.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): hechos de auditoría de MADE y libro de grants del host"
```

---

### Task 5: `CallMadeTool` — el host concede lecturas y pide confirmación para escrituras

El corazón de §2. `MadeOwner` habla con MADE como dueño de la política: lee el principal (una vez), lee una decisión por su id con el cursor de la tarea 2, emite y revoca (revocar un grant que MADE no conoce cuenta como hecho). `IssuedGrants` es la caché de §2.3: los grants que este host emitió y aún cubren algo, por sesión. `CallMadeTool` sigue el flujo:

1. Con el token de una confirmación aceptada y válida para esta llamada: registra `made.confirmation` accepted, asegura un grant confirm de 5 min con la acción y el alcance que se guardaron al pedirla y llama **una** vez.
2. Si no, llama. Si no es una denegación de MADE, no hay contexto (extensión anterior), la clase es never o la fase no expone la tool, o la decisión no se puede leer o no es una denegación: la respuesta original.
3. confirm: devuelve una `PendingConfirmation` nueva (token de 2 min).
4. auto: asegura un grant auto de 12 h y reintenta **una** vez; si la emisión falla, la denegación original.

«Asegurar un grant» mira primero la caché; dos llamadas a la vez comparten la misma emisión; tras emitir registra `made.grant_issued` y, si no puede (la sesión no está abierta en el log), revoca el grant en el acto: nunca queda un grant sin auditar. Los fallos se avisan en el log del host sólo con la acción y el código.

`FakeMade` (en `tests/support/`) es MADE 0.8.0 en memoria en lo que S3a toca (un único principal; cada tool de negocio exige un grant de su acción y su alcance, `definition` si lleva `definition_yaml` con `name:`, `global` si no; decisiones ordenadas por id con cursor exclusivo; `existing`, `conflict` y `not_found` como el real) con interruptores para simular fallos. Las tareas 6 a 10 lo reutilizan; la 11 prueba lo mismo con el binario real.

**Files:**
- Create: `src/domain/made/MadeCallContext.ts`, `src/application/services/MadeOwner.ts`, `src/application/services/IssuedGrants.ts`, `src/application/use-cases/CallMadeTool.ts`, `tests/support/FakeMade.ts`
- Test: `tests/unit/application/use-cases/CallMadeTool.test.ts`

**Interfaces:**
- Consumes: todo lo de las tareas 2 a 4, `McpConnection`, `ToolRefusal`, `ToolSuccess`, `RefusalCode`, `RecordFact`, `Clock`, `HostLog`.
- Produces:
  - `MadeCallContext.of(session: SessionId, phase: Phase | null, token: ConfirmationToken | null = null)`, campos `session`, `phase`, `token`
  - `MadeOwner(connection: () => Promise<McpConnection>)`: `#principal(): Promise<TrustedHostId>`, `#decision(id: MadeDecisionId): Promise<MadeDecision | null>`, `#issue(grant: MadeGrant): Promise<void>` (lanza la `ToolRefusal`), `#revoke(grant: MadeGrantId, reason: RevocationReason): Promise<void>`
  - `IssuedGrants`: `#covering(session, action, scope, now): MadeGrant | null`, `#add(grant)`, `#forget(session)`
  - `CallMadeTool({connection, owner, policy, confirmations, grants, record, facts, clock, log})`: `#execute(tool: ToolName, args: Record<string, unknown>, context: MadeCallContext | null): Promise<ToolOutcome | PendingConfirmation>`
  - `tests/support/FakeMade.ts`: `FakeMade(now?: () => number)` implementa `McpConnection`; `owner`, `grants: Map<string, Grant>`, `revoked: Set<string>`, `calls: string[]`, `failIssue`, `failDecisions`, `failRevoke`, `live(action, scope)`

- [ ] **Step 1: Test que falla**

`tests/support/FakeMade.ts`:

```ts
import { createHash } from "node:crypto";
import type { McpConnection } from "../../src/application/ports/McpConnection.ts";
import { SemVer } from "../../src/domain/distribution/SemVer.ts";
import { ProtocolVersion } from "../../src/domain/mcp/ProtocolVersion.ts";
import { RefusalCode } from "../../src/domain/mcp/RefusalCode.ts";
import { ServerIdentity } from "../../src/domain/mcp/ServerIdentity.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../src/domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../src/domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../src/domain/mcp/ToolOutcome.ts";
import { ToolRefusal } from "../../src/domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../src/domain/mcp/ToolSuccess.ts";

type Grant = { grant_id: string; actions: string[]; scope: Record<string, unknown>; valid_from: string; valid_until?: string; grantee_id: string; delegation_depth: number };
const canon = (o: unknown) => JSON.stringify(o, Object.keys(o as object).sort());
const refuse = (code: string, message: string) => ToolRefusal.of(RefusalCode.of(code), message, false);

// MADE 0.8.0 en modo embebido, en memoria y sólo en lo que S3a toca: un único principal dueño
// de la política; cada tool de negocio exige un grant de su acción y su alcance (definition si
// lleva `definition_yaml` con `name:`/`version:`, global si no) y, si no lo hay, deniega con la
// decisión registrada, que se lee con made_list_authorization_decisions (ids ordenados, cursor exclusivo).
export class FakeMade implements McpConnection {
  readonly server = ServerName.MADE; readonly identity = ServerIdentity.of("made-mcp", SemVer.of("0.8.0")); readonly protocol = ProtocolVersion.MCP_2024_11_05;
  readonly owner = "made-local-host-test";
  readonly grants = new Map<string, Grant>(); readonly revoked = new Set<string>(); readonly calls: string[] = [];
  readonly #decisions = new Map<string, Record<string, unknown>>(); #n = 0;
  now: () => number; failIssue = false; failDecisions = false; failRevoke = false;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  catalog(): Promise<ToolCatalog> { throw new Error("not needed"); }
  onExit(): void {}
  async close(): Promise<void> {}

  async call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
    this.calls.push(tool.value);
    switch (tool.value) {
      case "made_get_authorization_policy":
        return ToolSuccess.of({ policy: { owner: { principal_id: this.owner, kind: "trusted_host" }, grants: [...this.grants.values()], revocations: [...this.revoked] } }, "");
      case "made_list_authorization_decisions": {
        if (this.failDecisions) return refuse("unavailable", "store busy");
        const after = (args.after_decision_id as string | undefined) ?? "";
        const page = [...this.#decisions.keys()].sort().filter((id) => id > after).slice(0, Number(args.limit ?? 100)).map((id) => this.#decisions.get(id));
        return ToolSuccess.of({ decisions: page, next_after_decision_id: null }, "");
      }
      case "made_issue_authorization_grant": {
        if (this.failIssue) return refuse("unavailable", "store busy");
        const g = args as unknown as Grant; const existing = this.grants.get(g.grant_id);
        if (existing !== undefined) return canon(existing) === canon(g) ? ToolSuccess.of({ existing: true }, "") : refuse("conflict", "conflict: authorization_grant was changed by someone else first");
        this.grants.set(g.grant_id, g);
        return ToolSuccess.of({ existing: false }, "");
      }
      case "made_revoke_authorization_grant": {
        if (this.failRevoke) return refuse("unavailable", "store busy");
        const id = args.grant_id as string;
        if (!this.grants.has(id)) return refuse("not_found", "not found: authorization_grant");
        const existing = this.revoked.has(id); this.revoked.add(id);
        return ToolSuccess.of({ existing }, "");
      }
      default: return this.#business(tool.value, args);
    }
  }

  // Grants vigentes (sin revocar y dentro de su vigencia) que cubren una acción y un alcance.
  live(action: string, scope: Record<string, unknown>): Grant[] {
    const now = this.now();
    return [...this.grants.values()].filter((g) => !this.revoked.has(g.grant_id) && g.actions.includes(action) && JSON.stringify(g.scope) === JSON.stringify(scope)
      && Date.parse(g.valid_from) <= now && (g.valid_until === undefined || now < Date.parse(g.valid_until)));
  }

  #business(tool: string, args: Record<string, unknown>): ToolOutcome {
    const action = tool.replace(/^made_/, "");
    const yaml = typeof args.definition_yaml === "string" ? args.definition_yaml : null;
    const name = yaml === null ? null : /^name: (.+)$/m.exec(yaml)?.[1] ?? null;
    const version = yaml === null ? null : /^version: "?([^"\n]+)"?$/m.exec(yaml)?.[1] ?? null;
    const scope = name === null ? { kind: "global" } : { kind: "definition", name, version };
    if (this.live(action, scope).length > 0) return ToolSuccess.of({ tool, ok: true }, `${tool} ok`);
    const id = createHash("sha256").update(`decision-${this.#n++}`).digest("hex");
    this.#decisions.set(id, { decision_id: id, action, scope, outcome: "deny", denial_reason: "no_matching_grant", principal: { principal_id: this.owner } });
    return refuse("refused", `authorization decision ${id} denied the operation`);
  }
}
```

`tests/unit/application/use-cases/CallMadeTool.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import type { HostLog } from "../../../../src/application/ports/HostLog.ts";
import { IssuedGrants } from "../../../../src/application/services/IssuedGrants.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeGrantLedger } from "../../../../src/application/services/MadeGrantLedger.ts";
import { MadeOwner } from "../../../../src/application/services/MadeOwner.ts";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { CallMadeTool } from "../../../../src/application/use-cases/CallMadeTool.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { ConfirmationToken } from "../../../../src/domain/made/ConfirmationToken.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeCallContext } from "../../../../src/domain/made/MadeCallContext.ts";
import { MadeDecisionId } from "../../../../src/domain/made/MadeDecisionId.ts";
import { MadeGrantId } from "../../../../src/domain/made/MadeGrantId.ts";
import { PendingConfirmation } from "../../../../src/domain/made/PendingConfirmation.ts";
import { RevocationReason } from "../../../../src/domain/made/RevocationReason.ts";
import { RefusalCode } from "../../../../src/domain/mcp/RefusalCode.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const S1 = SessionId.of("s1");
const YAML = "name: pr_review_two_reviewers\nversion: \"1.0\"\n";
const t = (n: string) => ToolName.of(n);
let seed = 0;
const entropy = { bytes: (n: number) => new Uint8Array(n).fill(++seed % 256) };

function host(opts: { open?: boolean } = {}) {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z"));
  const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  if (opts.open !== false) record.execute(fact("session.opened", "o", { reason: "startup" }, StreamId.session(S1), clock.ms));
  const warnings: string[] = [];
  const log: HostLog = { info: () => {}, warn: (m, f) => { warnings.push(`${m} ${JSON.stringify(f)}`); }, error: () => {} };
  const connection = async () => made;
  const confirmations = new PendingConfirmations(entropy, clock);
  const uc = new CallMadeTool({ connection, owner: new MadeOwner(connection), policy: MadeActionPolicy.standard(), confirmations, grants: new IssuedGrants(),
    record, facts: new MadeFactFactory(clock, Actor.of("host", "host:1")), clock, log });
  return { clock, made, events, uc, warnings, confirmations };
}
const design = (token: ConfirmationToken | null = null) => MadeCallContext.of(S1, Phase.DESIGN, token);
const madeTypes = (events: InMemoryEventStore) => events.readStream(StreamId.session(S1)).map((r) => r.type.value).filter((x) => x.startsWith("made."));

test("auto: una lectura denegada se concede sola con un grant exacto de 12 h y un único reintento", async () => {
  const h = host();
  const out = await h.uc.execute(t("made_validate_ceremony_draft"), { definition_yaml: YAML }, design());
  assert.ok(out instanceof ToolSuccess);
  assert.deepEqual(h.made.calls, ["made_validate_ceremony_draft", "made_list_authorization_decisions", "made_get_authorization_policy", "made_issue_authorization_grant", "made_validate_ceremony_draft"]);
  const [grant] = [...h.made.grants.values()];
  assert.deepEqual({ ...grant, grant_id: "x" }, { grant_id: "x", grantee_id: h.made.owner, actions: ["validate_ceremony_draft"], scope: { kind: "definition", name: "pr_review_two_reviewers", version: "1.0" },
    valid_from: "2026-09-30T10:00:00.000Z", valid_until: "2026-09-30T22:00:00.000Z", delegation_depth: 0 });
  assert.equal(madeTypes(h.events).join(), "made.grant_issued");
  assert.deepEqual(MadeGrantLedger.read(h.events).live(S1, h.clock.now()).map((g) => g.id.value), [grant.grant_id]);

  h.made.calls.length = 0; // la caché: con el grant vivo, otra lectura igual no emite nada
  assert.ok(await h.uc.execute(t("made_validate_ceremony_draft"), { definition_yaml: YAML }, design()) instanceof ToolSuccess);
  assert.deepEqual(h.made.calls, ["made_validate_ceremony_draft"]);
});

test("caché: si MADE deniega con un grant del host vigente en caché, no se emite otro y se reintenta una vez", async () => {
  const h = host();
  await h.uc.execute(t("made_list_contracts"), {}, design());
  h.made.revoked.add([...h.made.grants.keys()][0]); // alguien lo revocó por fuera
  h.made.calls.length = 0;
  const out = await h.uc.execute(t("made_list_contracts"), {}, design());
  assert.ok(out instanceof ToolRefusal && MadeDecisionId.fromDenial(out.message) !== null, "la segunda denegación vuelve tal cual");
  assert.deepEqual(h.made.calls, ["made_list_contracts", "made_list_authorization_decisions", "made_list_contracts"]);
  assert.equal(h.made.grants.size, 1);
});

test("dos llamadas denegadas a la vez comparten una sola emisión", async () => {
  const h = host();
  const [a, b] = await Promise.all([h.uc.execute(t("made_list_contracts"), {}, design()), h.uc.execute(t("made_list_contracts"), {}, design())]);
  assert.ok(a instanceof ToolSuccess && b instanceof ToolSuccess);
  assert.equal(h.made.grants.size, 1);
});

test("sin contexto, fuera de fase, never, otra negativa o decisión ilegible: la denegación original", async () => {
  const h = host();
  const denied = (o: unknown) => o instanceof ToolRefusal && MadeDecisionId.fromDenial(o.message) !== null;
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, null)), "extensión anterior: sin sesión ni fase");
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, MadeCallContext.of(S1, Phase.INTERACTIVE))), "la fase no la expone");
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, MadeCallContext.of(S1, null))), "fase desconocida");
  assert.ok(denied(await h.uc.execute(t("made_get_status"), {}, design())), "auto, pero ninguna fase la expone");
  h.made.failDecisions = true;
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, design())), "la decisión no se pudo leer");
  h.made.failDecisions = false;
  assert.equal(h.made.grants.size, 0);
  assert.deepEqual(madeTypes(h.events), []);
  assert.deepEqual(await h.uc.execute(t("made_list_contracts"), {}, design()) instanceof ToolSuccess, true);
});

test("si la emisión falla se devuelve la denegación original y se avisa sin argumentos", async () => {
  const h = host();
  h.made.failIssue = true;
  const out = await h.uc.execute(t("made_validate_ceremony_draft"), { definition_yaml: YAML }, design());
  assert.ok(out instanceof ToolRefusal && /denied the operation/.test(out.message));
  assert.deepEqual(h.warnings, ["made grant not issued {\"action\":\"validate_ceremony_draft\",\"reason\":\"unavailable\"}"]);
  assert.equal(h.made.calls.filter((c) => c === "made_validate_ceremony_draft").length, 1, "sin grant no hay reintento");
});

test("sin la sesión abierta en el log el grant se revoca en el acto y no se usa", async () => {
  const h = host({ open: false });
  const out = await h.uc.execute(t("made_list_contracts"), {}, design());
  assert.ok(out instanceof ToolRefusal);
  assert.equal(h.made.grants.size, 1);
  assert.deepEqual([...h.made.revoked], [...h.made.grants.keys()]);
  assert.match(h.warnings[0], /^made grant not issued .*"reason":"DomainError"/);
});

test("confirm: sin token pide confirmación; con el token emite un grant de 5 min, registra la aceptación y llama", async () => {
  const h = host();
  const args = { definition_yaml: YAML };
  const asked = await h.uc.execute(t("made_publish_ceremony_definition"), args, design());
  assert.ok(asked instanceof PendingConfirmation);
  assert.equal(asked.action.value, "publish_ceremony_definition");
  assert.equal(asked.scopeSummary(), "definition pr_review_two_reviewers v1.0");
  assert.equal(h.made.grants.size, 0);

  h.made.calls.length = 0;
  const done = await h.uc.execute(t("made_publish_ceremony_definition"), args, design(asked.token));
  assert.ok(done instanceof ToolSuccess);
  assert.deepEqual(h.made.calls, ["made_get_authorization_policy", "made_issue_authorization_grant", "made_publish_ceremony_definition"]);
  const [grant] = [...h.made.grants.values()];
  assert.equal(Date.parse(grant.valid_until!) - Date.parse(grant.valid_from), 300_000);
  assert.deepEqual(madeTypes(h.events), ["made.confirmation", "made.grant_issued"]);
  const confirmation = h.events.readStream(StreamId.session(S1)).find((r) => r.type.value === "made.confirmation")!;
  assert.deepEqual(confirmation.payload.toValue(), { action: "publish_ceremony_definition", scopeSummary: "definition pr_review_two_reviewers v1.0", outcome: "accepted" });
  assert.ok(!confirmation.payload.text.includes("version: "), "nunca el YAML");

  const again = await h.uc.execute(t("made_publish_ceremony_definition"), args, design(asked.token));
  assert.ok(again instanceof ToolSuccess, "el grant de 5 min sigue vivo");
  assert.equal(madeTypes(h.events).filter((x) => x === "made.confirmation").length, 1, "el token ya no vale: no hay otra aceptación");
});

test("confirm: un token de otra llamada o caducado no concede nada y vuelve a pedir confirmación", async () => {
  const h = host();
  const asked = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design()) as PendingConfirmation;
  const other = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: `${YAML}# otra\n` }, design(asked.token));
  assert.ok(other instanceof PendingConfirmation && !other.token.equals(asked.token));
  const late = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design()) as PendingConfirmation;
  h.clock.ms += 120_000;
  assert.ok(await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design(late.token)) instanceof PendingConfirmation);
  assert.equal(h.made.grants.size, 0);
});

test("confirm: si la emisión con token falla, la llamada sigue y MADE la deniega (sin bucle)", async () => {
  const h = host();
  const asked = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design()) as PendingConfirmation;
  h.made.failIssue = true;
  const out = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design(asked.token));
  assert.ok(out instanceof ToolRefusal && /denied the operation/.test(out.message));
  assert.equal(h.warnings.length, 1);
});

test("MadeOwner: revocar dos veces o un grant desconocido no falla; otra negativa sí", async () => {
  const h = host();
  const owner = new MadeOwner(async () => h.made);
  await h.uc.execute(t("made_list_contracts"), {}, design());
  const id = MadeGrantId.of([...h.made.grants.keys()][0]);
  await owner.revoke(id, RevocationReason.SESSION_CLOSED);
  await owner.revoke(id, RevocationReason.SESSION_CLOSED);
  await owner.revoke(MadeGrantId.of(`pi-runtime-${"0".repeat(32)}`), RevocationReason.EXPIRED_CLEANUP);
  assert.deepEqual([...h.made.revoked], [id.value]);
  const broken = new MadeOwner(async () => ({ call: async () => ToolRefusal.of(RefusalCode.of("unavailable"), "boom", false) }) as never);
  await assert.rejects(broken.revoke(id, RevocationReason.SESSION_CLOSED));
  assert.equal(await broken.decision(MadeDecisionId.of("a".repeat(64))), null);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/CallMadeTool.test.ts`

Expected: FAIL por `Cannot find module …/src/application/services/IssuedGrants.ts`.

- [ ] **Step 3: Implementar**

`src/domain/made/MadeCallContext.ts`:

```ts
import type { SessionId } from "../events/SessionId.ts";
import type { Phase } from "../session/Phase.ts";
import type { ConfirmationToken } from "./ConfirmationToken.ts";

// Lo que la extensión dice de una llamada a MADE (S3a §2): de qué sesión es, en qué fase está
// Pi (null si no lo sabe) y, si el usuario ya aceptó, el token de su confirmación.
export class MadeCallContext {
  readonly session: SessionId; readonly phase: Phase | null; readonly token: ConfirmationToken | null;
  private constructor(session: SessionId, phase: Phase | null, token: ConfirmationToken | null) { this.session = session; this.phase = phase; this.token = token; }
  static of(session: SessionId, phase: Phase | null, token: ConfirmationToken | null = null): MadeCallContext { return new MadeCallContext(session, phase, token); }
}
```

`src/application/services/MadeOwner.ts`:

```ts
import type { MadeDecisionId } from "../../domain/made/MadeDecisionId.ts";
import { MadeDecision } from "../../domain/made/MadeDecision.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeGrantId } from "../../domain/made/MadeGrantId.ts";
import type { RevocationReason } from "../../domain/made/RevocationReason.ts";
import { TrustedHostId } from "../../domain/made/TrustedHostId.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { ToolSuccess } from "../../domain/mcp/ToolSuccess.ts";
import type { McpConnection } from "../ports/McpConnection.ts";

const POLICY = ToolName.of("made_get_authorization_policy");
const DECISIONS = ToolName.of("made_list_authorization_decisions");
const ISSUE = ToolName.of("made_issue_authorization_grant");
const REVOKE = ToolName.of("made_revoke_authorization_grant");

// El host como dueño de la política de MADE en modo embebido (único principal, el trusted
// host): lee la política y las decisiones, emite y revoca grants. Nunca lo ve el modelo.
export class MadeOwner {
  readonly #connection: () => Promise<McpConnection>; #principal: TrustedHostId | null = null;
  constructor(connection: () => Promise<McpConnection>) { this.#connection = connection; }

  // El dueño de la política, que también es quien recibe los grants. Se lee una vez.
  async principal(): Promise<TrustedHostId> {
    if (this.#principal !== null) return this.#principal;
    const policy = (await this.#call(POLICY, {})).structured as { policy?: { owner?: { principal_id?: unknown } } } | null;
    this.#principal = TrustedHostId.of(policy?.policy?.owner?.principal_id as string);
    return this.#principal;
  }

  // La decisión exacta, pidiendo la página que empieza en ella; null si no está o no se puede leer.
  async decision(id: MadeDecisionId): Promise<MadeDecision | null> {
    try {
      const cursor = id.cursor();
      const page = (await this.#call(DECISIONS, cursor === null ? { limit: 1 } : { after_decision_id: cursor, limit: 1 })).structured as { decisions?: unknown[] } | null;
      const found = (page?.decisions ?? []).find((d) => (d as { decision_id?: unknown }).decision_id === id.value);
      return found === undefined ? null : MadeDecision.parse(found);
    } catch { return null; }
  }

  async issue(grant: MadeGrant): Promise<void> { await this.#call(ISSUE, grant.issueArguments(await this.principal())); }

  // Revocar lo ya revocado es un no-op en MADE; un grant que MADE no conoce (otro store) ya no autoriza nada.
  async revoke(grant: MadeGrantId, reason: RevocationReason): Promise<void> {
    try { await this.#call(REVOKE, { grant_id: grant.value, reason: reason.value }); }
    catch (e) { if (!(e instanceof ToolRefusal && e.code.value === "not_found")) throw e; }
  }

  async #call(tool: ToolName, args: Record<string, unknown>): Promise<ToolSuccess> {
    const outcome = await (await this.#connection()).call(tool, args);
    if (outcome instanceof ToolRefusal) throw outcome;
    return outcome;
  }
}
```

`src/application/services/IssuedGrants.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { MadeAction } from "../../domain/made/MadeAction.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeScope } from "../../domain/made/MadeScope.ts";

// Caché de S3a §2.3: los grants que este host emitió y aún cubren algo, por sesión. Un grant
// vigente para la misma acción y alcance evita emitir otro. Se olvida al revocar o caducar.
export class IssuedGrants {
  readonly #bySession = new Map<string, MadeGrant[]>();

  covering(session: SessionId, action: MadeAction, scope: MadeScope, now: Timestamp): MadeGrant | null {
    const live = (this.#bySession.get(session.value) ?? []).filter((g) => !g.expired(now));
    this.#bySession.set(session.value, live);
    return live.find((g) => g.covers(action, scope, now)) ?? null;
  }

  add(grant: MadeGrant): void { this.#bySession.set(grant.session.value, [...(this.#bySession.get(grant.session.value) ?? []), grant]); }
  forget(session: SessionId): void { this.#bySession.delete(session.value); }
}
```

`src/application/use-cases/CallMadeTool.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import { CallDigest } from "../../domain/made/CallDigest.ts";
import { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import type { MadeAction } from "../../domain/made/MadeAction.ts";
import { MadeActionClass } from "../../domain/made/MadeActionClass.ts";
import type { MadeActionPolicy } from "../../domain/made/MadeActionPolicy.ts";
import type { MadeCallContext } from "../../domain/made/MadeCallContext.ts";
import { MadeDecisionId } from "../../domain/made/MadeDecisionId.ts";
import { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeScope } from "../../domain/made/MadeScope.ts";
import type { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import { RevocationReason } from "../../domain/made/RevocationReason.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Clock } from "../ports/Clock.ts";
import type { HostLog } from "../ports/HostLog.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import type { IssuedGrants } from "../services/IssuedGrants.ts";
import type { MadeFactFactory } from "../services/MadeFactFactory.ts";
import type { MadeOwner } from "../services/MadeOwner.ts";
import type { PendingConfirmations } from "../services/PendingConfirmations.ts";
import type { RecordFact } from "./RecordFact.ts";

type Deps = {
  connection: () => Promise<McpConnection>; owner: MadeOwner; policy: MadeActionPolicy; confirmations: PendingConfirmations; grants: IssuedGrants;
  record: RecordFact; facts: MadeFactFactory; clock: Clock; log: HostLog | null;
};

// S3a §2: el host como punto de control de la autorización de MADE. Llama; si MADE deniega,
// lee la decisión (acción y alcance exactos) y, si la clase y la fase lo permiten, emite un
// grant exacto y reintenta UNA vez (auto), o pide confirmación humana (confirm). Con el token
// de una confirmación aceptada, emite el grant de 5 min antes de llamar. Nunca hay bucles, y
// cualquier fallo del camino de autorización devuelve la denegación original.
export class CallMadeTool {
  readonly #d: Deps; readonly #inflight = new Map<string, Promise<MadeGrant>>();
  constructor(deps: Deps) { this.#d = deps; }

  async execute(tool: ToolName, args: Record<string, unknown>, context: MadeCallContext | null): Promise<ToolOutcome | PendingConfirmation> {
    const d = this.#d;
    const digest = context === null ? null : CallDigest.of(context.session, tool, args);
    if (context !== null && context.token !== null) {
      const accepted = d.confirmations.redeem(context.token, context.session, tool, digest!);
      if (accepted !== null) {
        this.#audit(() => d.record.execute(d.facts.confirmation(accepted, ConfirmationOutcome.ACCEPTED)));
        try { await this.#ensure(context.session, accepted.action, accepted.scope, MadeActionClass.CONFIRM); }
        catch (e) { this.#warn("made grant not issued", accepted.action, e); }
        return this.#call(tool, args);
      }
    }
    const outcome = await this.#call(tool, args);
    if (context === null || !(outcome instanceof ToolRefusal)) return outcome;
    const denied = MadeDecisionId.fromDenial(outcome.message);
    const actionClass = d.policy.admits(tool, context.phase);
    if (denied === null || actionClass === null) return outcome;
    const decision = await d.owner.decision(denied);
    if (decision === null || !decision.denied()) return outcome;
    if (actionClass.equals(MadeActionClass.CONFIRM)) return d.confirmations.open(context.session, tool, digest!, decision.action, decision.scope);
    try { await this.#ensure(context.session, decision.action, decision.scope, MadeActionClass.AUTO); }
    catch (e) { this.#warn("made grant not issued", decision.action, e); return outcome; }
    return this.#call(tool, args);
  }

  async #call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> { return (await this.#d.connection()).call(tool, args); }

  // Un grant vigente de esta sesión para la acción y el alcance, emitido si hace falta. Dos
  // llamadas a la vez comparten la misma emisión. Si el hecho no se puede registrar (la sesión
  // no está abierta en el log), el grant se revoca en el acto: nunca queda uno sin auditar.
  async #ensure(session: SessionId, action: MadeAction, scope: MadeScope, actionClass: MadeActionClass): Promise<MadeGrant> {
    const d = this.#d;
    const cached = d.grants.covering(session, action, scope, d.clock.now());
    if (cached !== null) return cached;
    const key = `${session.value}\n${action.value}\n${scope.key}`;
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const issuing = (async () => {
      const grant = MadeGrant.issue(session, action, scope, actionClass, d.clock.now());
      await d.owner.issue(grant);
      try { d.record.execute(d.facts.grantIssued(grant)); }
      catch (e) { await d.owner.revoke(grant.id, RevocationReason.SESSION_CLOSED).catch(() => undefined); throw e; }
      d.grants.add(grant);
      return grant;
    })();
    this.#inflight.set(key, issuing);
    try { return await issuing; } finally { this.#inflight.delete(key); }
  }

  #audit(fn: () => void): void { try { fn(); } catch (e) { this.#warn("made audit fact not recorded", null, e); } }

  #warn(message: string, action: MadeAction | null, e: unknown): void {
    const reason = e instanceof ToolRefusal ? e.code.value : e instanceof Error ? e.name : "unknown";
    this.#d.log?.warn(message, { action: action?.value ?? null, reason });
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/CallMadeTool.test.ts` y después `npm test`.

Expected: 10 tests nuevos en verde; `npm test` en verde (603 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/made/MadeCallContext.ts src/application/services/MadeOwner.ts src/application/services/IssuedGrants.ts src/application/use-cases/CallMadeTool.ts tests/support/FakeMade.ts tests/unit/application/use-cases/CallMadeTool.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): el host concede lecturas y pide confirmación para escrituras de MADE"
```

---

### Task 6: IPC — contexto de llamada, `needs_confirmation` y `confirmation`

El socket transporta S3a. `call` admite `sessionId`, `phase` y `confirmation` (el token); la negativa `needs_confirmation` lleva `confirmation: {token, action, scopeSummary}` y un mensaje que sólo nombra acción y alcance; el método nuevo `confirmation {sessionId, token, outcome: declined|no_ui}` anula el token y lo registra (`DeclineMadeConfirmation`; un token desconocido, ajeno o caducado responde `recorded: false`). `ServeHostRequest` manda por `CallMadeTool` las llamadas a MADE si la autorización está cableada, y las de KMP siguen por `CallServerTool`. `HostComposition` lo cablea todo con la conexión de MADE del pool. `HostCallError` conserva la confirmación (y se sigue reconociendo por su forma, no por su clase: cada extensión vive en su realm de jiti).

**Files:**
- Create: `src/application/dto/ConfirmationRequestDto.ts`, `src/application/dto/CallContextDto.ts`, `src/application/use-cases/DeclineMadeConfirmation.ts`
- Modify: `src/application/dto/HostRequestDto.ts`, `src/application/dto/HostResponseDto.ts`, `src/application/ports/HostCallError.ts`, `src/application/ports/HostGateway.ts`, `src/adapters/outbound/ipc/UnixSocketHostGateway.ts`, `src/adapters/inbound/ipc/UnixSocketHostServer.ts`, `src/application/mappers/HostResponseMapper.ts`, `src/application/use-cases/ServeHostRequest.ts`, `src/composition/HostComposition.ts`
- Test: `tests/unit/application/use-cases/ServeHostMadeRequests.test.ts`, `tests/unit/adapters/ipc/UnixSocketMade.test.ts`

**Interfaces:**
- Consumes: `CallMadeTool`, `MadeOwner`, `IssuedGrants` (Task 5), `PendingConfirmations` (Task 3), `MadeFactFactory` (Task 4), `ConfirmationToken`, `ConfirmationOutcome.refusal`, `MadeCallContext`, `PendingConfirmation`, `NodeEntropySource`.
- Produces:
  - `ConfirmationRequestDto` = `{token, action, scopeSummary}`; `CallContextDto` = `{sessionId, phase: string | null, confirmation?}`
  - `HostRequestDto` `call` + `sessionId?`, `phase?`, `confirmation?`; `{method: "confirmation", sessionId, token, outcome}`
  - `HostResponseDto.error.confirmation?: ConfirmationRequestDto`; `HostResponseMapper#needsConfirmation(id, pending)`
  - `HostCallError(kind, message, code?, confirmation?)`, campo `confirmation?`
  - `HostGateway#call(server, tool, args, context?: CallContextDto)`, `HostGateway#confirmation(id: SessionId, token: string, outcome: "declined" | "no_ui"): Promise<{recorded: boolean}>` (y en `UnixSocketHostGateway`)
  - `UnixSocketHostServer` admite `confirmation`
  - `DeclineMadeConfirmation(confirmations, record, facts)#execute(session, token, outcome): {recorded: boolean}`
  - `ServeHostRequest(project, pool, record?, summaries?, select?, catalogs?, made?: {call: CallMadeTool; decline: DeclineMadeConfirmation; revoke?: RevokeMadeGrants})` (`revoke` llega en la tarea 8)

- [ ] **Step 1: Test que falla**

`tests/unit/application/use-cases/ServeHostMadeRequests.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { IssuedGrants } from "../../../../src/application/services/IssuedGrants.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeOwner } from "../../../../src/application/services/MadeOwner.ts";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { CallMadeTool } from "../../../../src/application/use-cases/CallMadeTool.ts";
import { DeclineMadeConfirmation } from "../../../../src/application/use-cases/DeclineMadeConfirmation.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { ServeHostRequest } from "../../../../src/application/use-cases/ServeHostRequest.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const project = Project.of(ProjectRoot.of(process.cwd()));
const S1 = StreamId.session(SessionId.of("s1"));
const YAML = "name: pr_review_two_reviewers\nversion: \"1.0\"\n";
const kmp = new URL("../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;

function host() {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z")); const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  record.execute(fact("session.opened", "o", { reason: "startup" }, S1, clock.ms));
  const connection = async () => made; const facts = new MadeFactFactory(clock, Actor.of("host", "host:1"));
  let n = 0; const confirmations = new PendingConfirmations({ bytes: (k) => new Uint8Array(k).fill(++n) }, clock);
  const deps = {
    call: new CallMadeTool({ connection, owner: new MadeOwner(connection), policy: MadeActionPolicy.standard(), confirmations, grants: new IssuedGrants(), record, facts, clock, log: null }),
    decline: new DeclineMadeConfirmation(confirmations, record, facts),
  };
  const pool = new ServerPool(project, new StdioMcpConnector(2000), new Map([["kmp", { commandFor: () => ({ command: process.execPath, args: [kmp], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: "kmp" } }) }]]));
  return { made, events, pool, uc: new ServeHostRequest(project, pool, record, null, null, null, deps) };
}
const confirmations = (events: InMemoryEventStore) => events.readStream(S1).filter((r) => r.type.value === "made.confirmation").map((r) => (r.payload.toValue() as { outcome: string }).outcome);

test("call a MADE con sesión y fase: la lectura se concede sola y KMP no pasa por la autorización", async () => {
  const h = host();
  try {
    const ok = await h.uc.execute({ id: 1, method: "call", server: "made", tool: "made_validate_ceremony_draft", args: { definition_yaml: YAML }, sessionId: "s1", phase: "design" });
    assert.deepEqual(ok, { id: 1, ok: true, result: { structured: { tool: "made_validate_ceremony_draft", ok: true }, text: "made_validate_ceremony_draft ok" } });
    const legacy = await h.uc.execute({ id: 2, method: "call", server: "made", tool: "made_list_contracts", args: {} });
    assert.ok(!legacy.ok && legacy.error.kind === "refused" && legacy.error.code === "refused", "sin sesión: la denegación original");
    const echo = await h.uc.execute({ id: 3, method: "call", server: "kmp", tool: "kmp_echo", args: { a: 1 }, sessionId: "s1", phase: "design" });
    assert.ok(echo.ok);
    const bad = await h.uc.execute({ id: 4, method: "call", server: "made", tool: "made_list_contracts", args: {}, sessionId: "s1", phase: "cooking" });
    assert.ok(!bad.ok && bad.error.kind === "invalid");
  } finally { await h.pool.close(); }
});

test("needs_confirmation lleva token, acción y alcance; el token confirma una vez y el rechazo se registra", async () => {
  const h = host();
  try {
    const call = (id: number, confirmation?: string) => h.uc.execute({ id, method: "call", server: "made", tool: "made_publish_ceremony_definition", args: { definition_yaml: YAML }, sessionId: "s1", phase: "design", confirmation });
    const asked = await call(1);
    assert.ok(!asked.ok && asked.error.code === "needs_confirmation", JSON.stringify(asked));
    const c = asked.error.confirmation!;
    assert.deepEqual({ ...c, token: "t" }, { token: "t", action: "publish_ceremony_definition", scopeSummary: "definition pr_review_two_reviewers v1.0" });
    assert.equal(asked.error.message, "publish_ceremony_definition on definition pr_review_two_reviewers v1.0 needs human confirmation");
    assert.match(c.token, /^[0-9a-f]{32}$/);
    assert.ok((await call(2, c.token)).ok);

    const again = await call(3);
    assert.ok(again.ok, "el grant de 5 min sigue vivo");
    h.made.grants.clear();
    const second = await call(4);
    const token = !second.ok ? second.error.confirmation!.token : "";
    assert.deepEqual(await h.uc.execute({ id: 5, method: "confirmation", sessionId: "s1", token, outcome: "declined" }), { id: 5, ok: true, result: { recorded: true } });
    assert.deepEqual(await h.uc.execute({ id: 6, method: "confirmation", sessionId: "s1", token, outcome: "declined" }), { id: 6, ok: true, result: { recorded: false } });
    const noUi = await call(7);
    const t2 = !noUi.ok ? noUi.error.confirmation!.token : "";
    assert.deepEqual(await h.uc.execute({ id: 8, method: "confirmation", sessionId: "s1", token: t2, outcome: "no_ui" }), { id: 8, ok: true, result: { recorded: true } });
    assert.deepEqual(confirmations(h.events), ["accepted", "declined", "no_ui"]);
    for (const [token, outcome] of [[t2, "accepted"], ["zz", "declined"], [t2, "maybe"]]) {
      const bad = await h.uc.execute({ id: 9, method: "confirmation", sessionId: "s1", token, outcome });
      assert.ok(!bad.ok && bad.error.kind === "invalid", `${token} ${outcome}`);
    }
  } finally { await h.pool.close(); }
});

test("sin autorización de MADE cableada, confirmation es invalid y MADE va directo al pool", async () => {
  const uc = new ServeHostRequest(project, new ServerPool(project, new StdioMcpConnector(2000), new Map()));
  assert.deepEqual(await uc.execute({ id: 1, method: "confirmation", sessionId: "s1", token: "ab".repeat(16), outcome: "declined" }),
    { id: 1, ok: false, error: { kind: "invalid", message: "made authorization not available" } });
  const res = await uc.execute({ id: 2, method: "call", server: "made", tool: "made_list_contracts", args: {}, sessionId: "s1", phase: "design" });
  assert.ok(!res.ok && res.error.kind === "transport");
});
```

`tests/unit/adapters/ipc/UnixSocketMade.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnixSocketHostServer } from "../../../../src/adapters/inbound/ipc/UnixSocketHostServer.ts";
import { UnixSocketHostGateway } from "../../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import type { HostRequestDto } from "../../../../src/application/dto/HostRequestDto.ts";
import { HostCallError } from "../../../../src/application/ports/HostCallError.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";

test("S3a por el socket: la llamada lleva sesión, fase y token; needs_confirmation trae la confirmación; confirmation está permitido", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "ipc-")), "host.sock");
  const seen: HostRequestDto[] = [];
  const confirmation = { token: "ab".repeat(16), action: "publish_ceremony_definition", scopeSummary: "definition d v1.0" };
  const server = await UnixSocketHostServer.start(path, async (req) => {
    seen.push(req);
    if (req.method === "confirmation") return { id: req.id, ok: true, result: { recorded: true } };
    if (req.method === "call" && req.server === "made" && req.confirmation === undefined) return { id: req.id, ok: false, error: { kind: "refused", code: "needs_confirmation", message: "m", confirmation } };
    return { id: req.id, ok: true, result: { structured: null, text: "published" } };
  });
  try {
    const gw = await UnixSocketHostGateway.connect(path);
    const publish = ToolName.of("made_publish_ceremony_definition");
    await assert.rejects(gw.call(ServerName.MADE, publish, { y: 1 }, { sessionId: "s1", phase: "design" }),
      (e) => HostCallError.is(e) && e.code === "needs_confirmation" && JSON.stringify(e.confirmation) === JSON.stringify(confirmation));
    assert.deepEqual(await gw.call(ServerName.MADE, publish, { y: 1 }, { sessionId: "s1", phase: "design", confirmation: confirmation.token }), { structured: null, text: "published" });
    assert.deepEqual(await gw.confirmation(SessionId.of("s1"), confirmation.token, "declined"), { recorded: true });
    assert.deepEqual(await gw.call(ServerName.KMP, ToolName.of("kmp_ask"), {}), { structured: null, text: "published" });
    assert.deepEqual(seen.map((r) => r.method === "call" ? [r.sessionId ?? null, r.phase ?? null, r.confirmation ?? null] : [r.method]),
      [["s1", "design", null], ["s1", "design", confirmation.token], ["confirmation"], [null, null, null]]);
    gw.close();
  } finally { await server.close(); }
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/ServeHostMadeRequests.test.ts tests/unit/adapters/ipc/UnixSocketMade.test.ts`

Expected: FAIL por `Cannot find module …/src/application/use-cases/DeclineMadeConfirmation.ts` y, en el del socket, `gw.confirmation is not a function`.

- [ ] **Step 3: Implementar**

`src/application/dto/ConfirmationRequestDto.ts`:

```ts
// Lo que viaja en la negativa `needs_confirmation` (S3a §3): el token que la extensión reenvía
// si el usuario acepta, la acción de MADE y el alcance legible. Nunca argumentos.
export type ConfirmationRequestDto = { token: string; action: string; scopeSummary: string };
```

`src/application/dto/CallContextDto.ts`:

```ts
// Contexto de una llamada a una tool (S3a §2): la sesión de Pi, su fase (null si la extensión
// no la sabe) y el token de una confirmación aceptada.
export type CallContextDto = { sessionId: string; phase: string | null; confirmation?: string };
```

En `src/application/dto/HostRequestDto.ts`, sustituye:

```ts
export type HostRequestDto =
  | { id: number; method: "call"; server: string; tool: string; args: Record<string, unknown> }
  | { id: number; method: "catalog"; server: string }
```

por:

```ts
export type HostRequestDto =
  | { id: number; method: "call"; server: string; tool: string; args: Record<string, unknown>; sessionId?: string; phase?: string | null; confirmation?: string }
  | { id: number; method: "catalog"; server: string }
```

En `src/application/dto/HostRequestDto.ts`, sustituye:

```ts
  | { id: number; method: "summary"; sessionId: string }
  | { id: number; method: "select"; sessionId: string; phase: string; deadlineMs?: number; registered?: string[] };
```

por:

```ts
  | { id: number; method: "summary"; sessionId: string }
  | { id: number; method: "select"; sessionId: string; phase: string; deadlineMs?: number; registered?: string[] }
  | { id: number; method: "confirmation"; sessionId: string; token: string; outcome: string };
```

`src/application/dto/HostResponseDto.ts` (fichero completo, sustituye al actual):

```ts
import type { ConfirmationRequestDto } from "./ConfirmationRequestDto.ts";

export type HostResponseDto =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { kind: "refused" | "rpc" | "transport" | "denied" | "invalid"; message: string; code?: string | number; confirmation?: ConfirmationRequestDto } };
```

`src/application/ports/HostCallError.ts` (fichero completo, sustituye al actual):

```ts
import type { ConfirmationRequestDto } from "../dto/ConfirmationRequestDto.ts";

// Error del puerto HostGateway: el host rechazó la llamada o el transporte
// falló. Bajo Pi cada fichero de extensión vive en su propio realm de jiti
// (moduleCache: false), así que quien lo reciba NUNCA debe usar
// `instanceof`: la clase que lanza el gateway no es la misma que ve el
// consumidor. `HostCallError.is` lo reconoce por su forma (name + kind).
// confirmation: sólo en la negativa `needs_confirmation` de MADE (S3a §3).
export class HostCallError extends Error {
  readonly kind: string; readonly code?: string | number; readonly confirmation?: ConfirmationRequestDto;
  constructor(kind: string, message: string, code?: string | number, confirmation?: ConfirmationRequestDto) {
    super(message); this.name = "HostCallError"; this.kind = kind; this.code = code; this.confirmation = confirmation;
  }

  static is(e: unknown): e is HostCallError {
    if (typeof e !== "object" || e === null) return false;
    const x = e as { name?: unknown; kind?: unknown; message?: unknown };
    return x.name === "HostCallError" && typeof x.kind === "string" && typeof x.message === "string";
  }
}
```

En `src/application/ports/HostGateway.ts`, sustituye:

```ts
import type { Phase } from "../../domain/session/Phase.ts";
import type { FactDto } from "../dto/FactDto.ts";
```

por:

```ts
import type { Phase } from "../../domain/session/Phase.ts";
import type { CallContextDto } from "../dto/CallContextDto.ts";
import type { FactDto } from "../dto/FactDto.ts";
```

En `src/application/ports/HostGateway.ts`, sustituye:

```ts
  catalog(server: ServerName): Promise<ToolCatalog>;
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto>;
  health(): Promise<{ project: string; started: string[] }>;
```

por:

```ts
  catalog(server: ServerName): Promise<ToolCatalog>;
  // context (S3a): sesión, fase y token de confirmación; sin él, el host no autoriza nada por su cuenta.
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>, context?: CallContextDto): Promise<ToolCallResultDto>;
  // Una confirmación de MADE rechazada o imposible (sin UI): el host la registra y anula su token.
  confirmation(id: SessionId, token: string, outcome: "declined" | "no_ui"): Promise<{ recorded: boolean }>;
  health(): Promise<{ project: string; started: string[] }>;
```

En `src/adapters/outbound/ipc/UnixSocketHostGateway.ts`, sustituye:

```ts
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";
import type { CatalogDto } from "../../../application/dto/CatalogDto.ts";
```

por:

```ts
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";
import type { CallContextDto } from "../../../application/dto/CallContextDto.ts";
import type { CatalogDto } from "../../../application/dto/CatalogDto.ts";
```

En `src/adapters/outbound/ipc/UnixSocketHostGateway.ts`, sustituye:

```ts
  async catalog(server: ServerName): Promise<ToolCatalog> { return new CatalogMapper().toDomain(await this.raw<CatalogDto>({ method: "catalog", server: server.value })); }
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto> { return this.raw({ method: "call", server: server.value, tool: tool.value, args }); }
  health(): Promise<{ project: string; started: string[] }> { return this.raw({ method: "health" }); }
```

por:

```ts
  async catalog(server: ServerName): Promise<ToolCatalog> { return new CatalogMapper().toDomain(await this.raw<CatalogDto>({ method: "catalog", server: server.value })); }
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>, context?: CallContextDto): Promise<ToolCallResultDto> {
    return this.raw({ method: "call", server: server.value, tool: tool.value, args, ...(context ?? {}) });
  }
  confirmation(id: SessionId, token: string, outcome: "declined" | "no_ui"): Promise<{ recorded: boolean }> {
    return this.raw({ method: "confirmation", sessionId: id.value, token, outcome });
  }
  health(): Promise<{ project: string; started: string[] }> { return this.raw({ method: "health" }); }
```

En `src/adapters/outbound/ipc/UnixSocketHostGateway.ts`, sustituye:

```ts
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (res) => (res.ok ? resolve(res.result as T) : reject(new HostCallError(res.error.kind, res.error.message, res.error.code))));
      this.#sock.write(JSON.stringify({ ...req, id }) + "\n");
```

por:

```ts
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (res) => (res.ok ? resolve(res.result as T) : reject(new HostCallError(res.error.kind, res.error.message, res.error.code, res.error.confirmation))));
      this.#sock.write(JSON.stringify({ ...req, id }) + "\n");
```

En `src/adapters/inbound/ipc/UnixSocketHostServer.ts`, sustituye:

```ts

const ALLOWED = new Set(["call", "catalog", "health", "record", "summary", "select"]);
// sun_path admite 104–108 bytes según el sistema; 100 deja margen en todos.
```

por:

```ts

const ALLOWED = new Set(["call", "catalog", "health", "record", "summary", "select", "confirmation"]);
// sun_path admite 104–108 bytes según el sistema; 100 deja margen en todos.
```

En `src/application/mappers/HostResponseMapper.ts`, sustituye:

```ts
import type { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
```

por:

```ts
import type { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import type { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
```

En `src/application/mappers/HostResponseMapper.ts`, sustituye:

```ts
  refusal(id: number, r: ToolRefusal): HostResponseDto { return { id, ok: false, error: { kind: "refused", code: r.code.value, message: r.message } }; }
  invalid(id: number, message: string): HostResponseDto { return { id, ok: false, error: { kind: "invalid", message } }; }
```

por:

```ts
  refusal(id: number, r: ToolRefusal): HostResponseDto { return { id, ok: false, error: { kind: "refused", code: r.code.value, message: r.message } }; }
  // S3a §2.2.3: la acción escribe y hace falta una persona. El mensaje sólo nombra acción y alcance.
  needsConfirmation(id: number, p: PendingConfirmation): HostResponseDto {
    return { id, ok: false, error: { kind: "refused", code: "needs_confirmation", message: `${p.action.value} on ${p.scopeSummary()} needs human confirmation`,
      confirmation: { token: p.token.value, action: p.action.value, scopeSummary: p.scopeSummary() } } };
  }
  invalid(id: number, message: string): HostResponseDto { return { id, ok: false, error: { kind: "invalid", message } }; }
```

`src/application/use-cases/DeclineMadeConfirmation.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import type { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import type { ConfirmationToken } from "../../domain/made/ConfirmationToken.ts";
import type { MadeFactFactory } from "../services/MadeFactFactory.ts";
import type { PendingConfirmations } from "../services/PendingConfirmations.ts";
import type { RecordFact } from "./RecordFact.ts";

// S3a §3: el usuario rechazó la confirmación o Pi no tiene UI para pedirla. El host anula el
// token y lo registra como made.confirmation. Un token desconocido, ajeno o caducado no registra nada.
export class DeclineMadeConfirmation {
  readonly #confirmations: PendingConfirmations; readonly #record: RecordFact; readonly #facts: MadeFactFactory;
  constructor(confirmations: PendingConfirmations, record: RecordFact, facts: MadeFactFactory) { this.#confirmations = confirmations; this.#record = record; this.#facts = facts; }

  execute(session: SessionId, token: ConfirmationToken, outcome: ConfirmationOutcome): { recorded: boolean } {
    const pending = this.#confirmations.settle(token, session);
    if (pending === null) return { recorded: false };
    this.#record.execute(this.#facts.confirmation(pending, outcome));
    return { recorded: true };
  }
}
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
import { Timestamp } from "../../domain/events/Timestamp.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
```

por:

```ts
import { Timestamp } from "../../domain/events/Timestamp.ts";
import { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import { ConfirmationToken } from "../../domain/made/ConfirmationToken.ts";
import { MadeCallContext } from "../../domain/made/MadeCallContext.ts";
import { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
import type { ServerPool } from "../services/ServerPool.ts";
import { CallServerTool } from "./CallServerTool.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";
```

por:

```ts
import type { ServerPool } from "../services/ServerPool.ts";
import type { CallMadeTool } from "./CallMadeTool.ts";
import { CallServerTool } from "./CallServerTool.ts";
import type { DeclineMadeConfirmation } from "./DeclineMadeConfirmation.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts

export class ServeHostRequest {
```

por:

```ts

// S3a: la autorización de MADE gestionada por el host.
type MadeRequests = { call: CallMadeTool; decline: DeclineMadeConfirmation };

export class ServeHostRequest {
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
  readonly #record: RecordFact | null; readonly #summaries: ReadSessionStatus | null; readonly #select: SelectTools | null; readonly #catalogs: KnownCatalogs | null;
  // catalogs recuerda cada catálogo servido: SelectTools filtra con ellos las candidatas de L1.
  constructor(project: Project, pool: ServerPool, record: RecordFact | null = null, summaries: ReadSessionStatus | null = null,
    select: SelectTools | null = null, catalogs: KnownCatalogs | null = null) {
    this.#project = project; this.#pool = pool; this.#record = record; this.#summaries = summaries; this.#select = select; this.#catalogs = catalogs;
  }
```

por:

```ts
  readonly #record: RecordFact | null; readonly #summaries: ReadSessionStatus | null; readonly #select: SelectTools | null; readonly #catalogs: KnownCatalogs | null;
  readonly #made: MadeRequests | null;
  // catalogs recuerda cada catálogo servido: SelectTools filtra con ellos las candidatas de L1.
  constructor(project: Project, pool: ServerPool, record: RecordFact | null = null, summaries: ReadSessionStatus | null = null,
    select: SelectTools | null = null, catalogs: KnownCatalogs | null = null, made: MadeRequests | null = null) {
    this.#project = project; this.#pool = pool; this.#record = record; this.#summaries = summaries; this.#select = select; this.#catalogs = catalogs; this.#made = made;
  }
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
    }
    if (req.method === "health") return this.#responses.success(req.id, { project: this.#project.root.value, started: this.#pool.started().map(String) });
    let server: ServerName; let tool: ToolName | null = null;
    try {
      server = ServerName.of(req.server);
      if (req.method === "call") tool = ToolName.of(req.tool);
    } catch (e) {
```

por:

```ts
    }
    if (req.method === "confirmation") {
      const made = this.#made;
      if (made === null) return this.#responses.invalid(req.id, "made authorization not available");
      return this.#guarded(req.id, () => made.decline.execute(SessionId.of(req.sessionId), ConfirmationToken.of(req.token), ConfirmationOutcome.refusal(req.outcome)));
    }
    if (req.method === "health") return this.#responses.success(req.id, { project: this.#project.root.value, started: this.#pool.started().map(String) });
    let server: ServerName; let tool: ToolName | null = null; let context: MadeCallContext | null = null;
    try {
      server = ServerName.of(req.server);
      if (req.method === "call") { tool = ToolName.of(req.tool); context = ServeHostRequest.#context(req); }
    } catch (e) {
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
      }
      const outcome = await new CallServerTool(this.#pool).execute(server, tool!, (req as { args: Record<string, unknown> }).args ?? {});
      if (outcome instanceof ToolRefusal) return this.#responses.refusal(req.id, outcome);
```

por:

```ts
      }
      const args = (req as { args: Record<string, unknown> }).args ?? {};
      const outcome = server.equals(ServerName.MADE) && this.#made !== null
        ? await this.#made.call.execute(tool!, args, context)
        : await new CallServerTool(this.#pool).execute(server, tool!, args);
      if (outcome instanceof PendingConfirmation) return this.#responses.needsConfirmation(req.id, outcome);
      if (outcome instanceof ToolRefusal) return this.#responses.refusal(req.id, outcome);
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
      return this.#responses.failure(req.id, e);
    }
  }

```

por:

```ts
      return this.#responses.failure(req.id, e);
    }
  }

  // Sesión, fase y token de la llamada (S3a); sin sesión (extensión anterior), null: el host no autoriza nada.
  static #context(req: { sessionId?: string; phase?: string | null; confirmation?: string }): MadeCallContext | null {
    if (req.sessionId === undefined) return null;
    return MadeCallContext.of(SessionId.of(req.sessionId), req.phase === undefined || req.phase === null ? null : Phase.of(req.phase),
      req.confirmation === undefined ? null : ConfirmationToken.of(req.confirmation));
  }

```

En `src/composition/HostComposition.ts`, sustituye:

```ts
import { NodeEntropySource } from "../adapters/outbound/crypto/NodeEntropySource.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
```

por:

```ts
import { NodeEntropySource } from "../adapters/outbound/crypto/NodeEntropySource.ts";
import { IssuedGrants } from "../application/services/IssuedGrants.ts";
import { MadeFactFactory } from "../application/services/MadeFactFactory.ts";
import { MadeOwner } from "../application/services/MadeOwner.ts";
import { PendingConfirmations } from "../application/services/PendingConfirmations.ts";
import { CallMadeTool } from "../application/use-cases/CallMadeTool.ts";
import { DeclineMadeConfirmation } from "../application/use-cases/DeclineMadeConfirmation.ts";
import { MadeActionPolicy } from "../domain/made/MadeActionPolicy.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
```

En `src/composition/HostComposition.ts`, sustituye:

```ts
      HostComposition.#learningProject(paths, project, log), () => runner.runOnce());
    const serve = new ServeHostRequest(project, pool, record, status, select, catalogs);
    const server = await UnixSocketHostServer.start(paths.socketOf(project), (req) => serve.execute(req));
```

por:

```ts
      HostComposition.#learningProject(paths, project, log), () => runner.runOnce());
    // S3a: el host concede, pide confirmación y audita la autorización de MADE.
    const madeConnection = () => pool.connection(ServerName.MADE);
    const madeFacts = new MadeFactFactory(clock, Actor.of("host", hostActor));
    const confirmations = new PendingConfirmations(new NodeEntropySource(), clock);
    const made = {
      call: new CallMadeTool({ connection: madeConnection, owner: new MadeOwner(madeConnection), policy: MadeActionPolicy.standard(), confirmations, grants: new IssuedGrants(),
        record, facts: madeFacts, clock, log }),
      decline: new DeclineMadeConfirmation(confirmations, record, madeFacts),
    };
    const serve = new ServeHostRequest(project, pool, record, status, select, catalogs, made);
    const server = await UnixSocketHostServer.start(paths.socketOf(project), (req) => serve.execute(req));
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/ServeHostMadeRequests.test.ts tests/unit/adapters/ipc/UnixSocketMade.test.ts` y después `npm test`.

Expected: 4 tests nuevos en verde; `npm test` en verde (607 tests). Los tests del host con el MADE falso (`fake-mcp-server.ts`) no cambian: sus llamadas no traen contexto y su negativa no es una denegación de MADE.

- [ ] **Step 5: Commit**

```bash
git add src/application/dto/ConfirmationRequestDto.ts src/application/dto/CallContextDto.ts src/application/dto/HostRequestDto.ts src/application/dto/HostResponseDto.ts src/application/ports/HostCallError.ts src/application/ports/HostGateway.ts src/adapters/outbound/ipc/UnixSocketHostGateway.ts src/adapters/inbound/ipc/UnixSocketHostServer.ts src/application/mappers/HostResponseMapper.ts src/application/use-cases/DeclineMadeConfirmation.ts src/application/use-cases/ServeHostRequest.ts src/composition/HostComposition.ts tests/unit/application/use-cases/ServeHostMadeRequests.test.ts tests/unit/adapters/ipc/UnixSocketMade.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): contexto de llamada, needs_confirmation y confirmation por el socket"
```

---

### Task 7: Extensión — confirmación en la TUI de Pi y reenvío del token

§3 en `PiToolFactory`. Cada llamada lleva `HostExtension.callContext()` (sesión y fase en curso; null sin sesión). Si el host responde `needs_confirmation` y hay contexto:

- con UI (`ctx.hasUI`, el quinto argumento que Pi 0.87.1 pasa a `execute`), pregunta **una** vez con `ctx.ui.confirm("MADE: <acción>", "<alcance>. Allow this call?")` (con la señal de abort de la llamada); si acepta, repite la llamada con el token y lo que responda el host es la respuesta, también otro `needs_confirmation`: nunca se pregunta dos veces por la misma llamada;
- si rechaza (o el diálogo falla), avisa al host (`confirmation … declined`) y devuelve la negativa `refused (needs_confirmation_declined)`;
- sin UI (`pi -p`), avisa al host (`no_ui`) y devuelve `refused (needs_confirmation_no_ui)`.

El aviso al host es sólo auditoría: si falla, la negativa es la misma. El texto de la negativa tiene la forma que `PiEventFactMapper` ya reconoce, así que `tool.completed` queda `refused` con el código. La TUI está en inglés, como el resto de mensajes de Underpass.

**Files:**
- Modify: `src/adapters/inbound/pi/PiToolFactory.ts`, `src/adapters/inbound/pi/HostExtension.ts`, `src/adapters/inbound/pi/ServerToolsExtension.ts`
- Test: `tests/unit/adapters/inbound/pi/made-confirmation.test.ts`

**Interfaces:**
- Consumes: `HostGateway#call(…, context)`, `HostGateway#confirmation`, `HostCallError#confirmation` (Task 6), `CallContextDto`, `ConfirmationRequestDto`, `SessionId`.
- Produces:
  - `PiToolFactory#create(server, tool, gateway, context: () => CallContextDto | null = () => null)`; `execute(id, params, signal?, onUpdate?, ctx?: {hasUI?, ui?: {confirm(title, message, opts?)}})`
  - `HostExtension#callContext(): CallContextDto | null`
  - `ServerToolsExtension` pasa `() => host.callContext()`

- [ ] **Step 1: Test que falla**

`tests/unit/adapters/inbound/pi/made-confirmation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostExtension } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import { PiEventFactMapper } from "../../../../../src/adapters/inbound/pi/PiEventFactMapper.ts";
import { PiToolFactory } from "../../../../../src/adapters/inbound/pi/PiToolFactory.ts";
import type { CallContextDto } from "../../../../../src/application/dto/CallContextDto.ts";
import { McpToolMapper } from "../../../../../src/application/mappers/McpToolMapper.ts";
import { HostCallError } from "../../../../../src/application/ports/HostCallError.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";
import { Phase } from "../../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";

const REQUEST = { token: "ab".repeat(16), action: "publish_ceremony_definition", scopeSummary: "definition d v1.0" };
const CONTEXT: CallContextDto = { sessionId: "s1", phase: "design" };
const needs = () => new HostCallError("refused", "publish_ceremony_definition on definition d v1.0 needs human confirmation", "needs_confirmation", REQUEST);

// Un host que pide confirmación a la primera y, con el token, responde lo que diga `retry`.
function hostFake(retry: () => Promise<unknown> = async () => ({ structured: { published: true }, text: "published" })) {
  const calls: (CallContextDto | undefined)[] = []; const told: string[] = [];
  const gateway = {
    call: async (_s: ServerName, _t: unknown, _a: unknown, context?: CallContextDto) => { calls.push(context); if (context?.confirmation === undefined) throw needs(); return retry(); },
    confirmation: async (id: { value: string }, token: string, outcome: string) => { told.push(`${id.value} ${token} ${outcome}`); return { recorded: true }; },
  };
  return { calls, told, gateway: async () => gateway as never };
}
const publish = (host: ReturnType<typeof hostFake>, context: () => CallContextDto | null = () => CONTEXT) =>
  new PiToolFactory((j) => j).create(ServerName.MADE, new McpToolMapper().toDomain({ name: "made_publish_ceremony_definition", inputSchema: { type: "object" } }), host.gateway, context);
const ui = (answer: boolean | Error) => {
  const asked: string[] = [];
  return { asked, ctx: { hasUI: true, ui: { confirm: async (title: string, message: string) => { asked.push(`${title} | ${message}`); if (answer instanceof Error) throw answer; return answer; } } } };
};
const refusalCode = (e: Error) => PiEventFactMapper.outcomeOf(true, { content: [{ type: "text", text: e.message }] }, "made_publish_ceremony_definition");

test("aceptada: pregunta una vez con acción y alcance, repite con el token y devuelve el resultado", async () => {
  const host = hostFake(); const u = ui(true);
  const r = await publish(host).execute("c", { definition_yaml: "x" }, undefined, undefined, u.ctx);
  assert.deepEqual(r, { content: [{ type: "text", text: "published" }], details: { published: true } });
  assert.deepEqual(u.asked, ["MADE: publish_ceremony_definition | definition d v1.0. Allow this call?"]);
  assert.deepEqual(host.calls, [CONTEXT, { ...CONTEXT, confirmation: REQUEST.token }]);
  assert.deepEqual(host.told, []);
});

test("rechazada (o un diálogo que falla): negativa needs_confirmation_declined y el host lo registra", async () => {
  for (const answer of [false, new Error("dialog closed")]) {
    const host = hostFake(); const u = ui(answer);
    await assert.rejects(publish(host).execute("c", {}, undefined, undefined, u.ctx), (e: Error) => {
      assert.equal(e.message, "made_publish_ceremony_definition refused (needs_confirmation_declined): the user declined MADE publish_ceremony_definition on definition d v1.0");
      assert.deepEqual(refusalCode(e), { status: "refused", errorKind: "refused", errorCode: "needs_confirmation_declined" });
      return true;
    });
    assert.deepEqual(host.told, [`s1 ${REQUEST.token} declined`]);
    assert.equal(host.calls.length, 1, "sin token no hay segunda llamada");
  }
});

test("sin UI (pi -p): no pregunta, negativa needs_confirmation_no_ui y el host lo registra", async () => {
  for (const ctx of [{ hasUI: false, ui: ui(true).ctx.ui }, undefined]) {
    const host = hostFake();
    await assert.rejects(publish(host).execute("c", {}, undefined, undefined, ctx), (e: Error) => refusalCode(e).errorCode === "needs_confirmation_no_ui" && /has no UI/.test(e.message));
    assert.deepEqual(host.told, [`s1 ${REQUEST.token} no_ui`]);
  }
});

test("nunca se pregunta dos veces por la misma llamada: si el host vuelve a pedirla, es la respuesta", async () => {
  const host = hostFake(async () => { throw needs(); }); const u = ui(true);
  await assert.rejects(publish(host).execute("c", {}, undefined, undefined, u.ctx), (e: Error) => refusalCode(e).errorCode === "needs_confirmation");
  assert.equal(u.asked.length, 1);
});

test("sin contexto de sesión (host o extensión anterior) no se pregunta nada; un aviso al host que falla no cambia la negativa", async () => {
  const host = hostFake(); const u = ui(true);
  await assert.rejects(publish(host, () => null).execute("c", {}, undefined, undefined, u.ctx), (e: Error) => refusalCode(e).errorCode === "needs_confirmation");
  assert.deepEqual(u.asked, []);
  assert.deepEqual(host.calls, [undefined]);
  const broken = hostFake();
  const gw = await broken.gateway() as unknown as { confirmation: () => Promise<never> };
  gw.confirmation = async () => { throw new Error("host down"); };
  await assert.rejects(publish(broken).execute("c", {}, undefined, undefined, ui(false).ctx), /needs_confirmation_declined/);
});

test("callContext: null sin sesión; la sesión y la fase en curso después", async () => {
  const host = new HostExtension(async () => { throw new Error("no host"); }, new SelectPhaseTools(PhaseToolSelection.standard()));
  assert.equal(host.callContext(), null);
  const handlers = new Map<string, (e: unknown, ctx: unknown) => Promise<unknown>>();
  const pi = {
    on: (ev: string, h: (e: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(ev, h), registerCommand: () => {}, registerTool: () => {},
    getAllTools: () => [], getActiveTools: () => [], setActiveTools: () => {}, events: { on: () => {}, emit: () => {} },
  };
  host.register(pi as never);
  await handlers.get("session_start")!({}, { cwd: "/repo", hasUI: true, ui: { notify: () => {} }, sessionManager: { getSessionId: () => "s9" } });
  assert.deepEqual(host.callContext(), { sessionId: "s9", phase: "interactive" });
  host.applyPhase(pi as never, Phase.DESIGN);
  assert.deepEqual(host.callContext(), { sessionId: "s9", phase: "design" });
  await handlers.get("session_shutdown")!({}, {});
  assert.equal(host.callContext(), null);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/inbound/pi/made-confirmation.test.ts`

Expected: FAIL: sin contexto la llamada no se repite (`needs_confirmation` llega tal cual al modelo) y `host.callContext is not a function`.

- [ ] **Step 3: Implementar**

`src/adapters/inbound/pi/PiToolFactory.ts` (fichero completo, sustituye al actual):

```ts
import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { CallContextDto } from "../../../application/dto/CallContextDto.ts";
import type { ConfirmationRequestDto } from "../../../application/dto/ConfirmationRequestDto.ts";
import type { ToolCallResultDto } from "../../../application/dto/ToolCallResultDto.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolDescriptor } from "../../../domain/mcp/ToolDescriptor.ts";
import { HostCallError } from "../../../application/ports/HostCallError.ts";

// Lo que Pi 0.87.1 pasa como quinto argumento a execute: sólo lo que S3a usa.
type ToolContext = { hasUI?: boolean; ui?: { confirm(title: string, message: string, opts?: { signal?: AbortSignal }): Promise<boolean> } };

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.charCodeAt(max - 1) >= 0xd800 && text.charCodeAt(max - 1) <= 0xdbff ? max - 1 : max;
  return `${text.slice(0, cut)}\n[truncated ${text.length - cut} chars; full result in details]`;
}

// Espera una respuesta del host, pero un abort de Pi la corta (el resultado queda desconocido).
function abortable<T>(work: () => Promise<T>, signal: AbortSignal | undefined, tool: string): Promise<T> {
  let onAbort: (() => void) | undefined;
  return new Promise<T>((resolve, reject) => {
    work().then(resolve, reject);
    if (signal) {
      onAbort = () => reject(new Error(`${tool} aborted; outcome unknown`));
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }).finally(() => { if (signal && onAbort) signal.removeEventListener("abort", onAbort); });
}

export class PiToolFactory {
  readonly #toSchema: (json: Record<string, unknown>) => unknown; readonly #maxText: number;
  constructor(toSchema: (json: Record<string, unknown>) => unknown, maxText = 16_000) { this.#toSchema = toSchema; this.#maxText = maxText; }

  // context: sesión y fase de Pi para cada llamada (S3a); sin él, la llamada va como antes.
  create(server: ServerName, tool: ToolDescriptor, gateway: () => Promise<HostGateway>, context: () => CallContextDto | null = () => null) {
    const max = this.#maxText;
    const name = tool.name.value;
    return {
      name,
      label: name,
      description: tool.description.value,
      parameters: this.#toSchema(tool.schema.toJson()),
      async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolContext) {
        if (signal?.aborted) throw new Error(`${name} aborted; outcome unknown`);
        const base = context();
        const send = (confirmation?: string) => abortable(async (): Promise<ToolCallResultDto> => (await gateway()).call(server, tool.name, params,
          base === null ? undefined : confirmation === undefined ? base : { ...base, confirmation }), signal, name);
        try {
          let r: ToolCallResultDto;
          try { r = await send(); }
          catch (e) {
            // S3a §3: MADE pide una persona. Se pregunta una sola vez; si acepta, la llamada se
            // repite con el token y lo que responda el host es la respuesta (nunca otra pregunta).
            const request = base !== null && HostCallError.is(e) && e.code === "needs_confirmation" ? e.confirmation : undefined;
            if (request === undefined) throw e;
            r = await send(await PiToolFactory.#confirm(request, base!, gateway, ctx, signal));
          }
          return { content: [{ type: "text" as const, text: truncate(r.text, max) }], details: r.structured };
        } catch (e) {
          if (HostCallError.is(e)) throw new Error(`${name} ${e.kind} (${e.code ?? "-"}): ${e.message}`);
          throw e;
        }
      },
    };
  }

  // El token si el usuario acepta; si rechaza o no hay UI, lo comunica al host (que lo registra)
  // y lanza la negativa correspondiente. El aviso al host nunca impide la negativa.
  static async #confirm(request: ConfirmationRequestDto, base: CallContextDto, gateway: () => Promise<HostGateway>, ctx: ToolContext | undefined, signal?: AbortSignal): Promise<string> {
    const what = `MADE ${request.action} on ${request.scopeSummary}`;
    const tell = async (outcome: "declined" | "no_ui") => { try { await (await gateway()).confirmation(SessionId.of(base.sessionId), request.token, outcome); } catch { /* sólo auditoría */ } };
    if (ctx?.hasUI !== true || ctx.ui === undefined) {
      await tell("no_ui");
      throw new HostCallError("refused", `${what} needs human confirmation and this Pi session has no UI`, "needs_confirmation_no_ui");
    }
    let accepted = false;
    try { accepted = await ctx.ui.confirm(`MADE: ${request.action}`, `${request.scopeSummary}. Allow this call?`, signal ? { signal } : undefined); } catch { accepted = false; }
    if (!accepted) {
      await tell("declined");
      throw new HostCallError("refused", `the user declined ${what}`, "needs_confirmation_declined");
    }
    return request.token;
  }
}
```

En `src/adapters/inbound/pi/HostExtension.ts`, sustituye:

```ts
import type { SelectionDto } from "../../../application/dto/SelectionDto.ts";
```

por:

```ts
import type { CallContextDto } from "../../../application/dto/CallContextDto.ts";
import type { SelectionDto } from "../../../application/dto/SelectionDto.ts";
```

En `src/adapters/inbound/pi/HostExtension.ts`, sustituye:

```ts
    opening.catch(() => { if (this.#gateway === opening) this.#gateway = null; });
    this.#gateway = opening;
    return opening;
  }

  // Vuelve al conjunto completo de la fase. Si deshace una reducción de L1, la siguiente
```

por:

```ts
    opening.catch(() => { if (this.#gateway === opening) this.#gateway = null; });
    this.#gateway = opening;
    return opening;
  }

  // Sesión y fase en curso para cada llamada a una tool (S3a); sin sesión, null.
  callContext(): CallContextDto | null {
    return this.#sessionId === null ? null : { sessionId: this.#sessionId, phase: this.#phase.value };
  }

  // Vuelve al conjunto completo de la fase. Si deshace una reducción de L1, la siguiente
```

En `src/adapters/inbound/pi/ServerToolsExtension.ts`, sustituye:

```ts
          const catalog = await (await this.#host.gateway()).catalog(this.#server);
          for (const t of catalog.tools()) pi.registerTool(this.#tools.create(this.#server, t, () => this.#host.gateway()));
          this.#host.applyPhase(pi, Phase.INTERACTIVE);
```

por:

```ts
          const catalog = await (await this.#host.gateway()).catalog(this.#server);
          for (const t of catalog.tools()) pi.registerTool(this.#tools.create(this.#server, t, () => this.#host.gateway(), () => this.#host.callContext()));
          this.#host.applyPhase(pi, Phase.INTERACTIVE);
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/inbound/pi/made-confirmation.test.ts` y después `npm test`.

Expected: 6 tests nuevos en verde; `npm test` en verde (613 tests), incluidos los de `PiToolFactory.crossrealm.test.ts` y `extensions.test.ts`, que siguen creando tools con tres argumentos.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/inbound/pi/PiToolFactory.ts src/adapters/inbound/pi/HostExtension.ts src/adapters/inbound/pi/ServerToolsExtension.ts tests/unit/adapters/inbound/pi/made-confirmation.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): la extensión pide confirmación en la TUI y reenvía el token"
```

---

### Task 8: Ciclo de vida — revocación al cerrar la sesión y de huérfanos al arrancar

§4. `RevokeMadeGrants#execute(session?)` lee el libro (el de la sesión, o el log entero), revoca en MADE cada huérfano y registra `made.grant_revoked`; sin huérfanos no toca MADE (no arranca `made-mcp`); un fallo de MADE deja el grant para la próxima vez y nunca lanza. Devuelve cuántos huérfanos había y cuántos quedaron revocados (el CLI de la tarea 9 lo usa).

- `ServeHostRequest`, al registrar un `session.closed`, lanza en segundo plano la revocación de esa sesión (la respuesta a Pi no espera) y olvida su caché.
- `HostComposition`, al arrancar, revoca los huérfanos del log **después** de adoptar los spools de Pi muertos: un `session.closed` que esperaba en un spool ya cuenta. Un cierre adoptado más tarde (en un tick) se recoge en el siguiente arranque; mientras tanto el grant caduca solo en 12 h como mucho.

**Files:**
- Create: `src/application/use-cases/RevokeMadeGrants.ts`
- Modify: `src/application/use-cases/ServeHostRequest.ts`, `src/composition/HostComposition.ts`
- Test: `tests/unit/application/use-cases/RevokeMadeGrants.test.ts`

**Interfaces:**
- Consumes: `MadeGrantLedger` (Task 4), `MadeOwner`, `IssuedGrants`, `CallMadeTool`, `FakeMade` (Task 5), `DeclineMadeConfirmation`, `ServeHostRequest` (Task 6), `HostLog`.
- Produces:
  - `RevokeMadeGrants(events, owner, record, facts, clock, cache: IssuedGrants | null = null, log: HostLog | null = null)#execute(session: SessionId | null = null): Promise<{orphans: number; revoked: number}>`
  - `ServeHostRequest` usa `made.revoke` (opcional) al registrar `session.closed`
  - `HostComposition` cablea `made.revoke` y lo lanza al arrancar

- [ ] **Step 1: Test que falla**

`tests/unit/application/use-cases/RevokeMadeGrants.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import type { HostLog } from "../../../../src/application/ports/HostLog.ts";
import { IssuedGrants } from "../../../../src/application/services/IssuedGrants.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeOwner } from "../../../../src/application/services/MadeOwner.ts";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { CallMadeTool } from "../../../../src/application/use-cases/CallMadeTool.ts";
import { DeclineMadeConfirmation } from "../../../../src/application/use-cases/DeclineMadeConfirmation.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { RevokeMadeGrants } from "../../../../src/application/use-cases/RevokeMadeGrants.ts";
import { ServeHostRequest } from "../../../../src/application/use-cases/ServeHostRequest.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeCallContext } from "../../../../src/domain/made/MadeCallContext.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const HOUR = 3_600_000;
const stream = (s: string) => StreamId.session(SessionId.of(s));
const opened = (s: string, ms: number) => fact("session.opened", `o.${ms}`, { reason: "startup" }, stream(s), ms);
const closed = (s: string, ms: number) => fact("session.closed", `c.${ms}`, { reason: "quit" }, stream(s), ms);

// Un host con MADE falso: `grant(s, tool)` concede una lectura en la sesión s como lo haría una llamada real.
function host() {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z")); const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  const connection = async () => made; const owner = new MadeOwner(connection); const facts = new MadeFactFactory(clock, Actor.of("host", "host:1"));
  const issued = new IssuedGrants(); const lines: string[] = [];
  const log: HostLog = { info: (m, f) => { lines.push(`${m} ${JSON.stringify(f)}`); }, warn: (m, f) => { lines.push(`${m} ${JSON.stringify(f)}`); }, error: () => {} };
  const confirmations = new PendingConfirmations({ bytes: (k) => new Uint8Array(k).fill(1) }, clock);
  const call = new CallMadeTool({ connection, owner, policy: MadeActionPolicy.standard(), confirmations, grants: issued, record, facts, clock, log });
  const revoke = new RevokeMadeGrants(events, owner, record, facts, clock, issued, log);
  const grant = async (s: string, tool: string) => call.execute(ToolName.of(tool), {}, MadeCallContext.of(SessionId.of(s), Phase.DESIGN));
  const revocations = () => events.readStream(StreamId.HOST).filter((r) => r.type.value === "made.grant_revoked").map((r) => r.payload.toValue() as { session: string; reason: string });
  return { clock, made, events, record, facts, confirmations, call, revoke, grant, revocations, lines };
}

test("al cerrar una sesión se revocan sus grants (y sólo los suyos) y se registra cada revocación", async () => {
  const h = host();
  h.record.execute(opened("a", h.clock.ms)); h.record.execute(opened("b", h.clock.ms));
  await h.grant("a", "made_list_contracts"); await h.grant("a", "made_design_ceremony"); await h.grant("b", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  h.made.calls.length = 0;
  assert.deepEqual(await h.revoke.execute(SessionId.of("a")), { orphans: 2, revoked: 2 });
  assert.deepEqual(h.made.calls, ["made_revoke_authorization_grant", "made_revoke_authorization_grant"]);
  assert.equal(h.made.revoked.size, 2);
  assert.deepEqual(h.revocations().map((r) => [r.session, r.reason]), [["a", "session_closed"], ["a", "session_closed"]]);
  assert.deepEqual(await h.revoke.execute(SessionId.of("a")), { orphans: 0, revoked: 0 }, "nada que revocar dos veces");
  assert.match(h.lines.join("\n"), /made grants revoked \{"count":2,"session":"a"\}/);
});

test("al cerrar la sesión la caché se olvida: si se reabre, pide un grant nuevo", async () => {
  const h = host();
  h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  await h.revoke.execute(SessionId.of("a"));
  h.record.execute(opened("a", h.clock.ms + 1)); h.clock.ms += 2;
  await h.grant("a", "made_list_contracts");
  assert.equal(h.made.grants.size, 2);
});

test("al arrancar: huérfanos por sesión cerrada, abandonada o grant caducado; los vivos se quedan", async () => {
  const h = host();
  for (const s of ["closed", "idle", "live"]) h.record.execute(opened(s, h.clock.ms));
  // MADE no sabe de sesiones: un grant del mismo principal sirve a todas, así que cada una pide otra acción.
  await h.grant("closed", "made_list_contracts"); await h.grant("idle", "made_design_ceremony"); await h.grant("live", "made_diff_ceremony_definitions");
  h.record.execute(closed("closed", h.clock.ms));
  h.clock.ms += 13 * HOUR; // los grants auto (12 h) ya caducaron; la sesión live sigue activa
  h.record.execute(fact("turn.completed", "t", {}, stream("live"), h.clock.ms));
  assert.deepEqual(await h.revoke.execute(), { orphans: 3, revoked: 3 });
  assert.deepEqual(h.revocations().map((r) => [r.session, r.reason]).sort(), [["closed", "session_closed"], ["idle", "expired_cleanup"], ["live", "expired_cleanup"]]);
});

test("sin huérfanos no se toca MADE; si MADE falla, el grant queda para la próxima vez", async () => {
  const h = host();
  assert.deepEqual(await h.revoke.execute(), { orphans: 0, revoked: 0 });
  assert.deepEqual(h.made.calls, []);
  h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  h.made.failRevoke = true;
  assert.deepEqual(await h.revoke.execute(), { orphans: 1, revoked: 0 });
  assert.match(h.lines.join("\n"), /made grant not revoked .*"reason":"unavailable"/);
  h.made.failRevoke = false;
  assert.deepEqual(await h.revoke.execute(), { orphans: 1, revoked: 1 });
});

test("ServeHostRequest: registrar session.closed revoca los grants de la sesión en segundo plano", async () => {
  const h = host();
  const pool = new ServerPool(Project.of(ProjectRoot.of(process.cwd())), new StdioMcpConnector(2000), new Map());
  const uc = new ServeHostRequest(Project.of(ProjectRoot.of(process.cwd())), pool, h.record, null, null, null,
    { call: h.call, decline: new DeclineMadeConfirmation(h.confirmations, h.record, h.facts), revoke: h.revoke });
  const dto = (type: string, about: string) => ({ stream: "session" as const, sessionId: "a", type, typeVersion: 1, about, occurredAtMs: h.clock.ms, actor: { kind: "agent", id: "pi:1" }, payload: {} });
  await uc.execute({ id: 1, method: "record", fact: dto("session.opened", "o") });
  await uc.execute({ id: 2, method: "call", server: "made", tool: "made_list_contracts", args: {}, sessionId: "a", phase: "design" });
  assert.equal(h.made.grants.size, 1);
  assert.deepEqual(await uc.execute({ id: 3, method: "record", fact: dto("session.closed", "c") }), { id: 3, ok: true, result: { recorded: 1, idempotent: false } });
  const until = Date.now() + 2_000;
  while (h.revocations().length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(h.revocations().map((r) => r.reason), ["session_closed"]);
  assert.equal(h.made.revoked.size, 1);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/RevokeMadeGrants.test.ts`

Expected: FAIL por `Cannot find module …/src/application/use-cases/RevokeMadeGrants.ts`.

- [ ] **Step 3: Implementar**

`src/application/use-cases/RevokeMadeGrants.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Clock } from "../ports/Clock.ts";
import type { HostLog } from "../ports/HostLog.ts";
import type { IssuedGrants } from "../services/IssuedGrants.ts";
import type { MadeFactFactory } from "../services/MadeFactFactory.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";
import type { MadeOwner } from "../services/MadeOwner.ts";
import type { RecordFact } from "./RecordFact.ts";

// S3a §4: revoca en MADE los grants del host que ya no deben vivir y registra cada revocación
// (made.grant_revoked, stream del host). Con sesión, los de esa sesión al cerrarse; sin ella,
// todos los huérfanos del log (arranque del host y `underpass made revoke-orphans`). Sin
// huérfanos no toca MADE. Un fallo de MADE deja el grant para la próxima vez; nunca lanza.
export class RevokeMadeGrants {
  readonly #events: EventStore; readonly #owner: MadeOwner; readonly #record: RecordFact; readonly #facts: MadeFactFactory; readonly #clock: Clock;
  readonly #cache: IssuedGrants | null; readonly #log: HostLog | null;
  constructor(events: EventStore, owner: MadeOwner, record: RecordFact, facts: MadeFactFactory, clock: Clock, cache: IssuedGrants | null = null, log: HostLog | null = null) {
    this.#events = events; this.#owner = owner; this.#record = record; this.#facts = facts; this.#clock = clock; this.#cache = cache; this.#log = log;
  }

  // Cuántos huérfanos había y cuántos quedaron revocados y registrados.
  async execute(session: SessionId | null = null): Promise<{ orphans: number; revoked: number }> {
    if (session !== null) this.#cache?.forget(session);
    let orphans;
    try {
      const ledger = session === null ? MadeGrantLedger.read(this.#events) : MadeGrantLedger.forSession(this.#events, session);
      orphans = ledger.orphans(this.#clock.now()).filter((o) => session === null || o.grant.session.equals(session));
    } catch (e) { this.#log?.warn("made grants not read", { reason: (e as Error).name }); return { orphans: 0, revoked: 0 }; }
    let revoked = 0;
    for (const { grant, reason } of orphans) {
      try { await this.#owner.revoke(grant.id, reason); }
      catch (e) { this.#log?.warn("made grant not revoked", { grant: grant.id.value, reason: (e as { code?: { value?: string } }).code?.value ?? (e as Error).name }); continue; }
      try { this.#record.execute(this.#facts.grantRevoked(grant.id, grant.session, reason)); revoked++; }
      catch (e) { this.#log?.warn("made revocation not recorded", { grant: grant.id.value, reason: (e as Error).name }); }
    }
    if (revoked > 0) this.#log?.info("made grants revoked", { count: revoked, session: session?.value ?? null });
    return { orphans: orphans.length, revoked };
  }
}
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
import type { DeclineMadeConfirmation } from "./DeclineMadeConfirmation.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";
```

por:

```ts
import type { DeclineMadeConfirmation } from "./DeclineMadeConfirmation.ts";
import type { RevokeMadeGrants } from "./RevokeMadeGrants.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";
```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
// S3a: la autorización de MADE gestionada por el host.
type MadeRequests = { call: CallMadeTool; decline: DeclineMadeConfirmation };

```

por:

```ts
// S3a: la autorización de MADE gestionada por el host.
// revoke: al registrarse un session.closed, los grants de esa sesión se revocan en segundo plano.
type MadeRequests = { call: CallMadeTool; decline: DeclineMadeConfirmation; revoke?: RevokeMadeGrants };

```

En `src/application/use-cases/ServeHostRequest.ts`, sustituye:

```ts
      return this.#guarded(req.id, () => {
        const r = record.execute(new FactMapper().toDomain(req.fact));
        return { recorded: r.records.length, idempotent: r.idempotent };
```

por:

```ts
      return this.#guarded(req.id, () => {
        const fact = new FactMapper().toDomain(req.fact);
        const r = record.execute(fact);
        if (fact.type.value === "session.closed") void this.#made?.revoke?.execute(fact.stream.sessionId());
        return { recorded: r.records.length, idempotent: r.idempotent };
```

En `src/composition/HostComposition.ts`, sustituye:

```ts
import { DeclineMadeConfirmation } from "../application/use-cases/DeclineMadeConfirmation.ts";
import { MadeActionPolicy } from "../domain/made/MadeActionPolicy.ts";
```

por:

```ts
import { DeclineMadeConfirmation } from "../application/use-cases/DeclineMadeConfirmation.ts";
import { RevokeMadeGrants } from "../application/use-cases/RevokeMadeGrants.ts";
import { MadeActionPolicy } from "../domain/made/MadeActionPolicy.ts";
```

En `src/composition/HostComposition.ts`, sustituye:

```ts
    const confirmations = new PendingConfirmations(new NodeEntropySource(), clock);
    const made = {
      call: new CallMadeTool({ connection: madeConnection, owner: new MadeOwner(madeConnection), policy: MadeActionPolicy.standard(), confirmations, grants: new IssuedGrants(),
        record, facts: madeFacts, clock, log }),
      decline: new DeclineMadeConfirmation(confirmations, record, madeFacts),
    };
```

por:

```ts
    const confirmations = new PendingConfirmations(new NodeEntropySource(), clock);
    const owner = new MadeOwner(madeConnection); const issued = new IssuedGrants();
    const made = {
      call: new CallMadeTool({ connection: madeConnection, owner, policy: MadeActionPolicy.standard(), confirmations, grants: issued, record, facts: madeFacts, clock, log }),
      decline: new DeclineMadeConfirmation(confirmations, record, madeFacts),
      revoke: new RevokeMadeGrants(events, owner, record, madeFacts, clock, issued, log),
    };
```

En `src/composition/HostComposition.ts`, sustituye:

```ts
    adopt();
    void telemetry?.tickTraces();
```

por:

```ts
    adopt();
    // S3a §4: los grants que un host anterior dejó vivos (sesión cerrada o abandonada) se revocan al
    // arrancar, después de adoptar los spools: un session.closed que esperaba en uno ya cuenta.
    void made.revoke.execute();
    void telemetry?.tickTraces();
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/RevokeMadeGrants.test.ts` y después `npm test`.

Expected: 5 tests nuevos en verde; `npm test` en verde (618 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/RevokeMadeGrants.ts src/application/use-cases/ServeHostRequest.ts src/composition/HostComposition.ts tests/unit/application/use-cases/RevokeMadeGrants.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): revocación de grants al cerrar la sesión y de huérfanos al arrancar el host"
```

---

### Task 9: `underpass made grants|revoke-orphans`

§5. `ListMadeGrants` convierte el libro en filas (`MadeGrantRowDto`: id, sesión, acción, alcance legible, clase, caducidad y estado). `MadeCli` imprime una línea por grant (`<id>  <estado>  <clase>  <acción>  <alcance>  until <instante>  session <id>`), o `no MADE grants issued by the host`; `revoke-orphans` imprime `revoked <n>/<m> orphan MADE grants` (o `no orphan MADE grants`) y sale con 1 si alguno no se pudo revocar. `EventLogComposition#made(connect)` abre el log en lectura para `grants` y en escritura (sólo si existe; nunca lo crea) para `revoke-orphans`, y arranca MADE sólo si hay huérfanos; la conexión se cierra al terminar. Las revocaciones hechas a mano llevan el actor `human` `underpass-cli`.

**Files:**
- Create: `src/application/dto/MadeGrantRowDto.ts`, `src/application/use-cases/ListMadeGrants.ts`, `src/adapters/inbound/cli/MadeCli.ts`
- Modify: `src/composition/EventLogComposition.ts`, `src/adapters/inbound/cli/UnderpassCli.ts`, `src/composition/CliComposition.ts`
- Test: `tests/unit/adapters/inbound/cli/MadeCli.test.ts`, `tests/unit/composition/EventLogCompositionMade.test.ts`, `tests/unit/composition/CliCompositionMade.test.ts`

**Interfaces:**
- Consumes: `MadeGrantLedger` (Task 4), `MadeOwner` (Task 5), `RevokeMadeGrants` (Task 8), `MadeFactFactory`, `RecordFact`, `LazyEventStore`, `SystemClock`, `connect(ServerName.MADE)` de `CliComposition`.
- Produces:
  - `MadeGrantRowDto` = `{grantId, session, action, scope, class, validUntil, state}`
  - `ListMadeGrants(events, clock)#execute(): MadeGrantRowDto[]`
  - `MadeCli({grants, revoke, print})#run(args): Promise<number>` (uso: `usage: underpass made grants | revoke-orphans`)
  - `EventLogComposition#made(connect: () => Promise<McpConnection>): {run(args): Promise<number>}`
  - `UnderpassCli(setup, doctor, print, events?, metrics?, learning?, made?)`; uso con `made <grants|revoke-orphans>`

- [ ] **Step 1: Test que falla**

`tests/unit/adapters/inbound/cli/MadeCli.test.ts`:

```ts
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
```

`tests/unit/composition/EventLogCompositionMade.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SystemClock } from "../../../src/adapters/outbound/clock/SystemClock.ts";
import { MadeFactFactory } from "../../../src/application/services/MadeFactFactory.ts";
import { RecordFact } from "../../../src/application/use-cases/RecordFact.ts";
import { EventLogComposition } from "../../../src/composition/EventLogComposition.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { Actor } from "../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../src/domain/events/StreamId.ts";
import { MadeAction } from "../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../src/domain/made/MadeActionClass.ts";
import { MadeGrant } from "../../../src/domain/made/MadeGrant.ts";
import { MadeScope } from "../../../src/domain/made/MadeScope.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";
import { FakeMade } from "../../support/FakeMade.ts";
import { fact } from "../../support/recordFixtures.ts";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "underpass-made-"));
  const paths = new StatePaths({ HOME: home, XDG_STATE_HOME: join(home, "state") });
  const project = Project.of(ProjectRoot.of(home));
  const out: string[] = [];
  return { home, out, log: paths.eventLogOf(project), composition: new EventLogComposition(paths, project, (s) => out.push(s)) };
}

test("made sin log: grants y revoke-orphans no crean nada ni arrancan MADE", async () => {
  const { home, out, composition } = setup();
  let connects = 0;
  const made = composition.made(async () => { connects++; return new FakeMade(); });
  assert.equal(await made.run(["grants"]), 0);
  assert.equal(await made.run(["revoke-orphans"]), 0);
  assert.deepEqual(out, ["no MADE grants issued by the host", "no orphan MADE grants"]);
  assert.equal(connects, 0);
  assert.equal(existsSync(join(home, "state")), false);
});

test("made con un grant huérfano: grants lo lista, revoke-orphans lo revoca en MADE, lo registra y cierra la conexión", async () => {
  const { out, log, composition } = setup();
  const db = SqliteDatabase.open(log); const events = new SqliteEventStore(db); const clock = new SystemClock();
  const session = StreamId.session(SessionId.of("s1"));
  const record = new RecordFact(events, clock);
  record.execute(fact("session.opened", "o", { reason: "startup" }, session, clock.now().epochMs()));
  const grant = MadeGrant.issue(SessionId.of("s1"), MadeAction.of("list_contracts"), MadeScope.GLOBAL, MadeActionClass.AUTO, clock.now());
  record.execute(new MadeFactFactory(clock, Actor.of("host", "host:1")).grantIssued(grant));
  record.execute(fact("session.closed", "c", { reason: "quit" }, session, clock.now().epochMs()));
  db.close();

  const made = new FakeMade(); let closed = false;
  made.grants.set(grant.id.value, { grant_id: grant.id.value, actions: ["list_contracts"], scope: { kind: "global" }, valid_from: grant.validFrom.value, grantee_id: made.owner, delegation_depth: 0 });
  made.close = async () => { closed = true; };
  const verb = composition.made(async () => made);
  assert.equal(await verb.run(["grants"]), 0);
  assert.match(out[0], new RegExp(`^${grant.id.value}  active   auto     list_contracts  global  until .* session s1$`));
  assert.equal(await verb.run(["revoke-orphans"]), 0);
  assert.equal(out.at(-1), "revoked 1/1 orphan MADE grants");
  assert.ok(made.revoked.has(grant.id.value) && closed);
  const reread = new SqliteEventStore(SqliteDatabase.openReadOnly(log));
  const revoked = reread.readStream(StreamId.HOST).find((r) => r.type.value === "made.grant_revoked")!;
  assert.deepEqual(revoked.payload.toValue(), { grantId: grant.id.value, session: "s1", reason: "session_closed" });
  assert.deepEqual(revoked.actor, Actor.of("human", "underpass-cli"));
  assert.equal(await verb.run(["revoke-orphans"]), 0);
  assert.equal(out.at(-1), "no orphan MADE grants");
});
```

`tests/unit/composition/CliCompositionMade.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliComposition } from "../../../src/composition/CliComposition.ts";

test("underpass made grants por el CLI real: sin log lo dice y no crea el estado", async () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const out: string[] = [];
  const cli = CliComposition.build({ ...process.env, HOME: home, XDG_STATE_HOME: join(home, ".local/state"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CONFIG_HOME: join(home, ".config") }, (s) => out.push(s));
  assert.equal(await cli.run(["made", "grants"]), 0);
  assert.equal(await cli.run(["made"]), 2);
  assert.deepEqual(out, ["no MADE grants issued by the host", "usage: underpass made grants | revoke-orphans"]);
  assert.equal(existsSync(join(home, ".local/state")), false);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/inbound/cli/MadeCli.test.ts tests/unit/composition/EventLogCompositionMade.test.ts tests/unit/composition/CliCompositionMade.test.ts`

Expected: FAIL por `Cannot find module …/src/adapters/inbound/cli/MadeCli.ts` y `composition.made is not a function`.

- [ ] **Step 3: Implementar**

`src/application/dto/MadeGrantRowDto.ts`:

```ts
// Una fila de `underpass made grants` (S3a §5): sólo ids, acción, alcance legible, clase, caducidad y estado.
export type MadeGrantRowDto = { grantId: string; session: string; action: string; scope: string; class: string; validUntil: string; state: string };
```

`src/application/use-cases/ListMadeGrants.ts`:

```ts
import type { MadeGrantRowDto } from "../dto/MadeGrantRowDto.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";

// `underpass made grants`: los grants que el host registró en el log, con su estado de ahora.
export class ListMadeGrants {
  readonly #events: EventStore; readonly #clock: Clock;
  constructor(events: EventStore, clock: Clock) { this.#events = events; this.#clock = clock; }

  execute(): MadeGrantRowDto[] {
    const ledger = MadeGrantLedger.read(this.#events); const now = this.#clock.now();
    return ledger.grants().map((g) => ({ grantId: g.id.value, session: g.session.value, action: g.action.value, scope: g.scope.summary(), class: g.actionClass.value,
      validUntil: g.validUntil.value, state: ledger.state(g, now) }));
  }
}
```

`src/adapters/inbound/cli/MadeCli.ts`:

```ts
import type { ListMadeGrants } from "../../../application/use-cases/ListMadeGrants.ts";
import type { RevokeMadeGrants } from "../../../application/use-cases/RevokeMadeGrants.ts";

type Deps = { grants: ListMadeGrants; revoke: RevokeMadeGrants; print: (s: string) => void };
const USAGE = "usage: underpass made grants | revoke-orphans";

// `underpass made grants` y `underpass made revoke-orphans` (S3a §5).
export class MadeCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  async run(args: string[]): Promise<number> {
    const d = this.#d;
    if (args.length !== 1) return this.#usage();
    try {
      if (args[0] === "grants") {
        const rows = d.grants.execute();
        if (rows.length === 0) { d.print("no MADE grants issued by the host"); return 0; }
        for (const r of rows) d.print(`${r.grantId}  ${r.state.padEnd(7)}  ${r.class.padEnd(7)}  ${r.action}  ${r.scope}  until ${r.validUntil}  session ${r.session}`);
        return 0;
      }
      if (args[0] === "revoke-orphans") {
        const r = await d.revoke.execute();
        d.print(r.orphans === 0 ? "no orphan MADE grants" : `revoked ${r.revoked}/${r.orphans} orphan MADE grants`);
        return r.revoked === r.orphans ? 0 : 1;
      }
      return this.#usage();
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }

  #usage(): number { this.#d.print(USAGE); return 2; }
}
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import { LearningCli } from "../adapters/inbound/cli/LearningCli.ts";
import { MetricsCli } from "../adapters/inbound/cli/MetricsCli.ts";
```

por:

```ts
import { LearningCli } from "../adapters/inbound/cli/LearningCli.ts";
import { MadeCli } from "../adapters/inbound/cli/MadeCli.ts";
import { MetricsCli } from "../adapters/inbound/cli/MetricsCli.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import type { EventStore } from "../application/ports/EventStore.ts";
import type { Projection } from "../application/ports/Projection.ts";
```

por:

```ts
import type { EventStore } from "../application/ports/EventStore.ts";
import type { McpConnection } from "../application/ports/McpConnection.ts";
import type { Projection } from "../application/ports/Projection.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import { LearningFactFactory } from "../application/services/LearningFactFactory.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
```

por:

```ts
import { LearningFactFactory } from "../application/services/LearningFactFactory.ts";
import { MadeFactFactory } from "../application/services/MadeFactFactory.ts";
import { MadeOwner } from "../application/services/MadeOwner.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import { LearningReport } from "../application/use-cases/LearningReport.ts";
import { ListSessions } from "../application/use-cases/ListSessions.ts";
```

por:

```ts
import { LearningReport } from "../application/use-cases/LearningReport.ts";
import { ListMadeGrants } from "../application/use-cases/ListMadeGrants.ts";
import { ListSessions } from "../application/use-cases/ListSessions.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import { RecordFact } from "../application/use-cases/RecordFact.ts";
import { SessionTrace } from "../application/use-cases/SessionTrace.ts";
```

por:

```ts
import { RecordFact } from "../application/use-cases/RecordFact.ts";
import { RevokeMadeGrants } from "../application/use-cases/RevokeMadeGrants.ts";
import { SessionTrace } from "../application/use-cases/SessionTrace.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts

  // Las mismas proyecciones que mantiene el host (HostComposition).
```

por:

```ts

  // `underpass made`: grants sólo lee; revoke-orphans escribe en un log que ya exista y sólo
  // arranca MADE (connect) si hay huérfanos. La conexión se cierra al terminar.
  made(connect: () => Promise<McpConnection>): { run(args: string[]): Promise<number> } {
    return {
      run: async (args: string[]) => {
        let stores: Stores | null = null;
        const events = new LazyEventStore(() => (stores ??= this.#open(args[0] === "revoke-orphans" ? "write" : "read")).events);
        const opened: { connection: Promise<McpConnection> | null } = { connection: null };
        const clock = new SystemClock();
        const revoke = new RevokeMadeGrants(events, new MadeOwner(() => (opened.connection ??= connect())), new RecordFact(events, clock),
          new MadeFactFactory(clock, Actor.of("human", "underpass-cli")), clock);
        try { return await new MadeCli({ grants: new ListMadeGrants(events, clock), revoke, print: this.#print }).run(args); }
        finally { if (opened.connection !== null) await (await opened.connection.catch(() => null))?.close(); }
      },
    };
  }

  // Las mismas proyecciones que mantiene el host (HostComposition).
```

En `src/adapters/inbound/cli/UnderpassCli.ts`, sustituye:

```ts
type Verb = { run(args: string[]): number };
const USAGE = "usage: underpass setup | doctor | update | events <sessions|show|tools|kpis|trace|verify|export|import|rebuild|ack-gaps> | learning <report|mode> | metrics [--session <id>]";

```

por:

```ts
type Verb = { run(args: string[]): number };
type AsyncVerb = { run(args: string[]): Promise<number> };
const USAGE = "usage: underpass setup | doctor | update | events <sessions|show|tools|kpis|trace|verify|export|import|rebuild|ack-gaps> | learning <report|mode> | made <grants|revoke-orphans> | metrics [--session <id>]";

```

En `src/adapters/inbound/cli/UnderpassCli.ts`, sustituye:

```ts
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void; readonly #events: Verb | null; readonly #metrics: Verb | null;
  readonly #learning: Verb | null;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void, events: Verb | null = null, metrics: Verb | null = null, learning: Verb | null = null) {
    this.#setup = setup; this.#doctor = doctor; this.#print = print; this.#events = events; this.#metrics = metrics; this.#learning = learning;
  }
```

por:

```ts
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void; readonly #events: Verb | null; readonly #metrics: Verb | null;
  readonly #learning: Verb | null; readonly #made: AsyncVerb | null;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void, events: Verb | null = null, metrics: Verb | null = null, learning: Verb | null = null, made: AsyncVerb | null = null) {
    this.#setup = setup; this.#doctor = doctor; this.#print = print; this.#events = events; this.#metrics = metrics; this.#learning = learning; this.#made = made;
  }
```

En `src/adapters/inbound/cli/UnderpassCli.ts`, sustituye:

```ts
    if (verb === "learning" && this.#learning !== null) return this.#learning.run(argv.slice(1));
    this.#print(USAGE);
```

por:

```ts
    if (verb === "learning" && this.#learning !== null) return this.#learning.run(argv.slice(1));
    if (verb === "made" && this.#made !== null) return this.#made.run(argv.slice(1));
    this.#print(USAGE);
```

En `src/composition/CliComposition.ts`, sustituye:

```ts

    return new UnderpassCli(setup, doctor, print, eventLog.cli(), eventLog.metrics(), eventLog.learning());
  }
```

por:

```ts

    return new UnderpassCli(setup, doctor, print, eventLog.cli(), eventLog.metrics(), eventLog.learning(), eventLog.made(() => connect(ServerName.MADE)));
  }
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/inbound/cli/MadeCli.test.ts tests/unit/composition/EventLogCompositionMade.test.ts tests/unit/composition/CliCompositionMade.test.ts` y después `npm test`.

Expected: 7 tests nuevos en verde; `npm test` en verde (625 tests). El uso de `underpass` inserta `made <grants|revoke-orphans>` antes de `metrics`, así que las aserciones existentes sobre el uso siguen valiendo.

- [ ] **Step 5: Commit**

```bash
git add src/application/dto/MadeGrantRowDto.ts src/application/use-cases/ListMadeGrants.ts src/adapters/inbound/cli/MadeCli.ts src/composition/EventLogComposition.ts src/adapters/inbound/cli/UnderpassCli.ts src/composition/CliComposition.ts tests/unit/adapters/inbound/cli/MadeCli.test.ts tests/unit/composition/EventLogCompositionMade.test.ts tests/unit/composition/CliCompositionMade.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): underpass made grants|revoke-orphans"
```

---

### Task 10: `doctor [made-auth]` y la línea `made:` de `/underpass-status`

§5. `DiagnoseMadeAuthorization` nunca emite nada ni lanza:

- `host authorization`: OK si el host lee la política como dueño (`made_get_authorization_policy`, sólo lectura) con la misma conexión de MADE que usa el resto de `doctor`; FAIL si no (el host no podría conceder nada).
- `orphan grants`: WARN con los grants del host **vigentes** cuya sesión cerró o se abandonó, y el remedio `underpass made revoke-orphans`; los ya caducados no autorizan nada y no avisan.
- `shared store`: WARN informativo si el store de MADE guarda más de una política (otra instalación, p. ej. el plugin de Claude Code, lo comparte). Lo cuenta `SqliteMadePolicyCensus` leyendo `authorization_policy_state` en sólo lectura; si el store no existe o no se lee, no hay línea.
  - *Enmienda de la revisión final (spec §5):* con los valores por defecto el plugin de Claude Code comparte store y política, así que el censo también cuenta los grants cuyo id no empieza por `pi-runtime-` (WARN). Con 0 políticas la línea ya no dice «only pi-runtime's policy»: es WARN con el remedio `underpass setup`. El OK dice que ningún otro cliente ha emitido grants y que cualquiera que abra el store actúa como el mismo principal.

`/underpass-status` añade `made: <n> active grants · <m> confirmations` (grants vigentes emitidos en la sesión y confirmaciones pedidas en ella) si el host lo envía (`SessionStatusDto.made`, opcional como el resto).

**Files:**
- Create: `src/application/ports/MadePolicyCensus.ts`, `src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts`, `src/application/use-cases/DiagnoseMadeAuthorization.ts`, `src/application/dto/SessionMadeDto.ts`, `src/application/use-cases/ReadMadeStatus.ts`
- Modify: `src/domain/diagnosis/CheckSection.ts`, `src/application/use-cases/DiagnoseInstallation.ts`, `src/composition/EventLogComposition.ts`, `src/composition/CliComposition.ts`, `src/application/dto/SessionStatusDto.ts`, `src/application/use-cases/ReadSessionStatus.ts`, `src/composition/HostComposition.ts`, `src/adapters/inbound/pi/HostExtension.ts`
- Test: `tests/unit/application/use-cases/DiagnoseMadeAuthorization.test.ts`, `tests/unit/application/use-cases/DiagnoseInstallationMadeAuth.test.ts`, `tests/unit/adapters/inbound/pi/made-status.test.ts`, `tests/unit/composition/EventLogCompositionMade.test.ts`

**Interfaces:**
- Consumes: `MadeGrantLedger` (Task 4), `MadeOwner` (Task 5), `EventLogComposition#made` y el test de la tarea 9, `DiagnoseInstallation`, `ReadSessionStatus`, `HostExtension`.
- Produces:
  - `CheckSection.MADE_AUTH` (`made-auth`)
  - `MadePolicyCensus#policies(store: StorePath): number | null`; `SqliteMadePolicyCensus`
  - `DiagnoseMadeAuthorization(events, census, store, clock)#execute(connection: McpConnection | null): Promise<Check[]>`
  - `DiagnoseInstallation(…, eventLog?, madeAuth?: {execute(conn: McpConnection | null): Promise<Check[]>})`
  - `EventLogComposition#madeAuthorization(census, store)`
  - `SessionMadeDto` = `{activeGrants, confirmations}`; `SessionStatusDto.made?`; `ReadMadeStatus(events, clock)#execute(session): SessionMadeDto`; `ReadSessionStatus(…, learning?, made?: ReadMadeStatus)`

- [ ] **Step 1: Test que falla**

`tests/unit/application/use-cases/DiagnoseMadeAuthorization.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { SqliteMadePolicyCensus } from "../../../../src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { DiagnoseMadeAuthorization } from "../../../../src/application/use-cases/DiagnoseMadeAuthorization.ts";
import { ReadMadeStatus } from "../../../../src/application/use-cases/ReadMadeStatus.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { CheckSection } from "../../../../src/domain/diagnosis/CheckSection.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../../src/domain/made/MadeActionClass.ts";
import { MadeGrant } from "../../../../src/domain/made/MadeGrant.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import { RefusalCode } from "../../../../src/domain/mcp/RefusalCode.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const STORE = StorePath.of("/s/ceremonies.sqlite3");
const S1 = SessionId.of("s1");
const lines = (checks: { section: CheckSection; status: { value: string }; name: { value: string }; detail: { value: string } }[]) =>
  checks.map((c) => `${c.section.value} ${c.status.value} ${c.name.value} — ${c.detail.value}`);

// Un log con un grant de la sesión s1; `close` la cierra (el grant queda huérfano).
function log(close: boolean) {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z")); const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  record.execute(fact("session.opened", "o", { reason: "startup" }, StreamId.session(S1), clock.ms));
  record.execute(new MadeFactFactory(clock, Actor.of("host", "host:1")).grantIssued(MadeGrant.issue(S1, MadeAction.of("list_contracts"), MadeScope.GLOBAL, MadeActionClass.AUTO, clock.now())));
  if (close) record.execute(fact("session.closed", "c", { reason: "quit" }, StreamId.session(S1), clock.ms));
  return { clock, events };
}

test("[made-auth] en verde: el host lee la política, sin huérfanos, store propio", async () => {
  const { clock, events } = log(false);
  const checks = await new DiagnoseMadeAuthorization(events, { policies: () => 1 }, STORE, clock).execute(new FakeMade());
  assert.deepEqual(lines(checks), [
    "made-auth OK host authorization — the host owns the MADE policy and can grant exact actions",
    "made-auth OK orphan grants — none",
    "made-auth OK shared store — only pi-runtime's policy",
  ]);
});

test("[made-auth] avisa de huérfanos vigentes y del store compartido; FAIL si la política no se lee", async () => {
  const { clock, events } = log(true);
  const refusing = { call: async () => ToolRefusal.of(RefusalCode.of("refused"), "nope", false) };
  const checks = await new DiagnoseMadeAuthorization(events, { policies: () => 2 }, STORE, clock).execute(refusing as never);
  assert.deepEqual(lines(checks), [
    "made-auth FAIL host authorization — cannot read the MADE policy as its owner (refused); run underpass setup",
    "made-auth WARN orphan grants — 1 host grants still valid after their session ended; run underpass made revoke-orphans",
    "made-auth WARN shared store — the MADE store holds 2 authorization policies; another installation (e.g. the Claude Code plugin) shares it",
  ]);
  clock.ms += 12 * 3_600_000; // caducado: ya no autoriza nada, no es un aviso
  assert.equal(lines(await new DiagnoseMadeAuthorization(events, { policies: () => null }, STORE, clock).execute(null)).join("\n"), "made-auth OK orphan grants — none");
  const broken = { readAll: () => { throw new Error("disk"); } } as unknown as EventStore;
  assert.deepEqual(lines(await new DiagnoseMadeAuthorization(broken, { policies: () => null }, STORE, clock).execute(null)), ["made-auth WARN orphan grants — event log unreadable (Error)"]);
});

test("el censo lee el store de MADE en sólo lectura y nunca lo crea", () => {
  const dir = mkdtempSync(join(tmpdir(), "made-store-"));
  const census = new SqliteMadePolicyCensus();
  assert.equal(census.policies(StorePath.of(join(dir, "missing.sqlite3"))), null);
  const path = join(dir, "ceremonies.sqlite3");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE authorization_policy_state (policy_id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload BLOB NOT NULL)");
  db.exec("INSERT INTO authorization_policy_state VALUES ('p1', 1, x''), ('p2', 1, x'')");
  db.close();
  assert.equal(census.policies(StorePath.of(path)), 2);
  writeFileSync(join(dir, "other.sqlite3"), "not sqlite");
  assert.equal(census.policies(StorePath.of(join(dir, "other.sqlite3"))), null);
});

test("estado de MADE de una sesión: grants vigentes y confirmaciones", () => {
  const { clock, events } = log(false);
  assert.deepEqual(new ReadMadeStatus(events, clock).execute(S1), { activeGrants: 1, confirmations: 0 });
  assert.deepEqual(new ReadMadeStatus(events, clock).execute(SessionId.of("s2")), { activeGrants: 0, confirmations: 0 });
});
```

`tests/unit/application/use-cases/DiagnoseInstallationMadeAuth.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpToolMapper } from "../../../../src/application/mappers/McpToolMapper.ts";
import type { McpConnection } from "../../../../src/application/ports/McpConnection.ts";
import { DiagnoseInstallation } from "../../../../src/application/use-cases/DiagnoseInstallation.ts";
import { DiscoverMadeCapabilities } from "../../../../src/application/use-cases/DiscoverMadeCapabilities.ts";
import type { VerifyPinnedBinaries } from "../../../../src/application/use-cases/VerifyPinnedBinaries.ts";
import { VerifyServerProfiles } from "../../../../src/application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { Check } from "../../../../src/domain/diagnosis/Check.ts";
import { CheckDetail } from "../../../../src/domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../../../src/domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../../../src/domain/diagnosis/CheckSection.ts";
import { BinaryName } from "../../../../src/domain/distribution/BinaryName.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";

const profiles = ToolProfiles.standard();
const connection = (s: ServerName) => ({ server: s, identity: ServerIdentity.of("x", SemVer.of("0.8.0")), protocol: null as never, onExit() {}, close: async () => {},
  catalog: async () => ToolCatalog.of(s, ServerIdentity.of("x", SemVer.of("1.0.0")),
    [...new Set(profiles.forServer(s).flatMap((p) => p.required.map(String)))].map((n) => new McpToolMapper().toDomain({ name: n, inputSchema: {} }))),
  call: async () => ToolSuccess.of({ schema_version: "1.0", server: { version: "0.8.0" }, declared_limits: [{ id: "agent_roster_is_process_local" }] }, "") });

test("doctor añade [made-auth] con la misma conexión de MADE que usan los demás checks", async () => {
  const seen: (McpConnection | null)[] = []; const opened: McpConnection[] = [];
  const madeAuth = { execute: async (c: McpConnection | null) => { seen.push(c); return [Check.ok(CheckSection.MADE_AUTH, CheckName.of("host authorization"), CheckDetail.of("ok"))]; } };
  const doctor = new DiagnoseInstallation(
    { execute: async () => [{ name: BinaryName.KMP, path: "/b/k", status: "verified" }, { name: BinaryName.MADE, path: "/b/m", status: "verified" }] } as unknown as VerifyPinnedBinaries,
    { version: async () => SemVer.of("0.87.1") }, { install: async () => {}, isRegistered: async () => true }, { doctor: async () => true } as never,
    { load: () => new Map(), save: () => {} }, async (s) => { const c = connection(s); opened.push(c as never); return c as never; }, new VerifyServerProfiles(profiles),
    new DiscoverMadeCapabilities(), SemVer.of("0.87.1"), null, madeAuth);
  const report = await doctor.execute(false);
  assert.equal(seen.length, 1);
  assert.ok(seen[0] === opened[1], "la conexión de MADE, no la de KMP");
  assert.deepEqual(report.checks().filter((c) => c.section.equals(CheckSection.MADE_AUTH)).map((c) => c.name.value), ["host authorization"]);
  assert.equal(CheckSection.of("made-auth"), CheckSection.MADE_AUTH);
});
```

`tests/unit/adapters/inbound/pi/made-status.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostExtension } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";

test("/underpass-status añade la línea made con grants vigentes y confirmaciones (sólo si el host la envía)", async () => {
  let made: unknown = { activeGrants: 2, confirmations: 1 };
  const gateway = { health: async () => ({ project: "/repo", started: [] }), summary: async () => ({ summary: null, logPosition: 1, sessionChainIntact: true, made }), onClose: () => {}, close: () => {} };
  const host = new HostExtension(async () => gateway as never, new SelectPhaseTools(PhaseToolSelection.standard()));
  const handlers = new Map<string, (e: unknown, ctx: unknown) => Promise<unknown>>(); const commands = new Map<string, { handler: (a: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    on: (ev: string, h: (e: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(ev, h), registerCommand: (n: string, o: { handler: (a: string, ctx: unknown) => Promise<void> }) => commands.set(n, o),
    registerTool: () => {}, getAllTools: () => [], getActiveTools: () => [], setActiveTools: () => {}, events: { on: () => {}, emit: () => {} },
  };
  host.register(pi as never);
  const notes: string[] = [];
  const ctx = { cwd: "/repo", hasUI: true, ui: { notify: (m: string) => notes.push(m) }, sessionManager: { getSessionId: () => "s1" } };
  await handlers.get("session_start")!({}, ctx);
  await commands.get("underpass-status")!.handler("", ctx);
  assert.equal(notes.at(-1)!.split("\n").at(-1), "made: 2 active grants · 1 confirmations");
  made = undefined; // un host anterior a S3a
  await commands.get("underpass-status")!.handler("", ctx);
  assert.ok(!notes.at(-1)!.includes("made:"));
});
```

En `tests/unit/composition/EventLogCompositionMade.test.ts`, sustituye:

```ts
import { MadeScope } from "../../../src/domain/made/MadeScope.ts";
import { Project } from "../../../src/domain/project/Project.ts";
```

por:

```ts
import { MadeScope } from "../../../src/domain/made/MadeScope.ts";
import { StorePath } from "../../../src/domain/made/StorePath.ts";
import { Project } from "../../../src/domain/project/Project.ts";
```

En `tests/unit/composition/EventLogCompositionMade.test.ts`, sustituye:

```ts
  assert.equal(out.at(-1), "no orphan MADE grants");
});
```

por:

```ts
  assert.equal(out.at(-1), "no orphan MADE grants");
});

test("madeAuthorization sin log: sin huérfanos y sin crear nada; el censo decide la línea del store", async () => {
  const { home, composition } = setup();
  const checks = await composition.madeAuthorization({ policies: () => null }, StorePath.of("/nowhere/ceremonies.sqlite3")).execute(null);
  assert.deepEqual(checks.map((c) => `${c.status.value} ${c.name.value}`), ["OK orphan grants"]);
  assert.equal(existsSync(join(home, "state")), false);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/DiagnoseMadeAuthorization.test.ts tests/unit/application/use-cases/DiagnoseInstallationMadeAuth.test.ts tests/unit/adapters/inbound/pi/made-status.test.ts tests/unit/composition/EventLogCompositionMade.test.ts`

Expected: FAIL por `Cannot find module …/src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts` (y los demás módulos nuevos).

- [ ] **Step 3: Implementar**

En `src/domain/diagnosis/CheckSection.ts`, sustituye:

```ts
  static readonly LEARNING = new CheckSection("learning");
  static of(raw: string): CheckSection {
    if (typeof raw !== "string") throw DomainError.because(`unknown check section ${raw}`);
    const found = [CheckSection.PI, CheckSection.KMP, CheckSection.MADE, CheckSection.HOST, CheckSection.EVENTS, CheckSection.TELEMETRY, CheckSection.LEARNING].find((s) => s.value === raw);
    if (!found) throw DomainError.because(`unknown check section ${raw}`);
```

por:

```ts
  static readonly LEARNING = new CheckSection("learning");
  static readonly MADE_AUTH = new CheckSection("made-auth");
  static of(raw: string): CheckSection {
    if (typeof raw !== "string") throw DomainError.because(`unknown check section ${raw}`);
    const found = [CheckSection.PI, CheckSection.KMP, CheckSection.MADE, CheckSection.HOST, CheckSection.EVENTS, CheckSection.TELEMETRY, CheckSection.LEARNING, CheckSection.MADE_AUTH].find((s) => s.value === raw);
    if (!found) throw DomainError.because(`unknown check section ${raw}`);
```

`src/application/ports/MadePolicyCensus.ts`:

```ts
import type { StorePath } from "../../domain/made/StorePath.ts";

// Cuántas políticas de autorización guarda el store de MADE (más de una: lo comparte otra
// instalación, p. ej. el plugin de Claude Code). null si no existe o no se puede leer.
export interface MadePolicyCensus { policies(store: StorePath): number | null; }
```

`src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts`:

```ts
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MadePolicyCensus } from "../../../application/ports/MadePolicyCensus.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";

// Lee el store de MADE en sólo lectura (tabla authorization_policy_state de made-mcp 0.8.0):
// nunca lo crea ni lo modifica; cualquier fallo es "no se sabe".
export class SqliteMadePolicyCensus implements MadePolicyCensus {
  policies(store: StorePath): number | null {
    if (!existsSync(store.value)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(store.value, { readOnly: true });
      db.exec("PRAGMA busy_timeout=2000;");
      return Number((db.prepare("SELECT COUNT(*) AS n FROM authorization_policy_state").get() as { n: number }).n);
    } catch { return null; }
    finally { db?.close(); }
  }
}
```

`src/application/use-cases/DiagnoseMadeAuthorization.ts`:

```ts
import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { MadePolicyCensus } from "../ports/MadePolicyCensus.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";
import { MadeOwner } from "../services/MadeOwner.ts";

const S = CheckSection.MADE_AUTH;
const check = (kind: "ok" | "warn" | "fail", name: string, detail: string) => Check[kind](S, CheckName.of(name), CheckDetail.of(detail));

// Sección [made-auth] de doctor (S3a §5). Nunca emite nada ni lanza:
// - host authorization: el host puede leer la política como dueño (sólo lectura);
// - orphan grants: WARN si hay grants del host vigentes cuya sesión ya cerró o se abandonó;
// - shared store: WARN informativo si el store guarda más de una política.
export class DiagnoseMadeAuthorization {
  readonly #events: EventStore; readonly #census: MadePolicyCensus; readonly #store: StorePath; readonly #clock: Clock;
  constructor(events: EventStore, census: MadePolicyCensus, store: StorePath, clock: Clock) { this.#events = events; this.#census = census; this.#store = store; this.#clock = clock; }

  async execute(connection: McpConnection | null): Promise<Check[]> {
    const checks: Check[] = [];
    if (connection !== null) {
      try { await new MadeOwner(async () => connection).principal(); checks.push(check("ok", "host authorization", "the host owns the MADE policy and can grant exact actions")); }
      catch (e) { checks.push(check("fail", "host authorization", `cannot read the MADE policy as its owner (${e instanceof ToolRefusal ? e.code.value : (e as Error).name}); run underpass setup`)); }
    }
    try {
      const now = this.#clock.now();
      const valid = MadeGrantLedger.read(this.#events).orphans(now).filter((o) => !o.grant.expired(now)).length;
      checks.push(valid === 0 ? check("ok", "orphan grants", "none")
        : check("warn", "orphan grants", `${valid} host grants still valid after their session ended; run underpass made revoke-orphans`));
    } catch (e) { checks.push(check("warn", "orphan grants", `event log unreadable (${(e as Error).name})`)); }
    const policies = this.#census.policies(this.#store);
    if (policies !== null && policies > 1) checks.push(check("warn", "shared store", `the MADE store holds ${policies} authorization policies; another installation (e.g. the Claude Code plugin) shares it`));
    else if (policies !== null) checks.push(check("ok", "shared store", "only pi-runtime's policy"));
    return checks;
  }
}
```

En `src/application/use-cases/DiagnoseInstallation.ts`, sustituye:

```ts
  readonly #profiles: VerifyServerProfiles; readonly #capabilities: DiscoverMadeCapabilities; readonly #piVersion: SemVer;
  readonly #eventLog: { execute(): Check[] } | null;

  constructor(verify: VerifyPinnedBinaries, runtime: PiRuntimeInspector, pi: PiPackageManager, kmp: KmpLifecycle, fingerprints: FingerprintRepository,
    connect: (s: ServerName) => Promise<McpConnection>, profiles: VerifyServerProfiles, capabilities: DiscoverMadeCapabilities, piVersion: SemVer,
    eventLog: { execute(): Check[] } | null = null) {
    this.#verify = verify; this.#runtime = runtime; this.#pi = pi; this.#kmp = kmp; this.#fingerprints = fingerprints;
    this.#connect = connect; this.#profiles = profiles; this.#capabilities = capabilities; this.#piVersion = piVersion;
    this.#eventLog = eventLog;
  }
```

por:

```ts
  readonly #profiles: VerifyServerProfiles; readonly #capabilities: DiscoverMadeCapabilities; readonly #piVersion: SemVer;
  readonly #eventLog: { execute(): Check[] } | null; readonly #madeAuth: { execute(conn: McpConnection | null): Promise<Check[]> } | null;

  // madeAuth (S3a): la sección [made-auth], con la conexión de MADE ya abierta para el resto de checks.
  constructor(verify: VerifyPinnedBinaries, runtime: PiRuntimeInspector, pi: PiPackageManager, kmp: KmpLifecycle, fingerprints: FingerprintRepository,
    connect: (s: ServerName) => Promise<McpConnection>, profiles: VerifyServerProfiles, capabilities: DiscoverMadeCapabilities, piVersion: SemVer,
    eventLog: { execute(): Check[] } | null = null, madeAuth: { execute(conn: McpConnection | null): Promise<Check[]> } | null = null) {
    this.#verify = verify; this.#runtime = runtime; this.#pi = pi; this.#kmp = kmp; this.#fingerprints = fingerprints;
    this.#connect = connect; this.#profiles = profiles; this.#capabilities = capabilities; this.#piVersion = piVersion;
    this.#eventLog = eventLog; this.#madeAuth = madeAuth;
  }
```

En `src/application/use-cases/DiagnoseInstallation.ts`, sustituye:

```ts
          report = report.add(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL) ? Check.ok(x.s, x.n, x.d) : Check.warn(x.s, x.n, x.d));
        }
```

por:

```ts
          report = report.add(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL) ? Check.ok(x.s, x.n, x.d) : Check.warn(x.s, x.n, x.d));
          if (this.#madeAuth !== null) report = report.add(...(await this.#madeAuth.execute(conn)));
        }
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import type { EventStore } from "../application/ports/EventStore.ts";
import type { McpConnection } from "../application/ports/McpConnection.ts";
```

por:

```ts
import type { EventStore } from "../application/ports/EventStore.ts";
import type { MadePolicyCensus } from "../application/ports/MadePolicyCensus.ts";
import type { McpConnection } from "../application/ports/McpConnection.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import { DiagnoseLearning } from "../application/use-cases/DiagnoseLearning.ts";
import { DiagnoseTelemetry } from "../application/use-cases/DiagnoseTelemetry.ts";
```

por:

```ts
import { DiagnoseLearning } from "../application/use-cases/DiagnoseLearning.ts";
import { DiagnoseMadeAuthorization } from "../application/use-cases/DiagnoseMadeAuthorization.ts";
import { DiagnoseTelemetry } from "../application/use-cases/DiagnoseTelemetry.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
import type { Check } from "../domain/diagnosis/Check.ts";
import { Actor } from "../domain/events/Actor.ts";
```

por:

```ts
import type { Check } from "../domain/diagnosis/Check.ts";
import type { StorePath } from "../domain/made/StorePath.ts";
import { Actor } from "../domain/events/Actor.ts";
```

En `src/composition/EventLogComposition.ts`, sustituye:

```ts
          ...new DiagnoseLearning(s.events, s.projections).execute(),
        ];
      },
    };
```

por:

```ts
          ...new DiagnoseLearning(s.events, s.projections).execute(),
        ];
      },
    };
  }

  // Sección [made-auth] de doctor (S3a §5): el log en sólo lectura, abierto al primer uso.
  madeAuthorization(census: MadePolicyCensus, store: StorePath): { execute(conn: McpConnection | null): Promise<Check[]> } {
    return {
      execute: (conn) => {
        let events: EventStore | null = null;
        return new DiagnoseMadeAuthorization(new LazyEventStore(() => (events ??= this.#open("read").events)), census, store, new SystemClock()).execute(conn);
      },
    };
```

En `src/composition/CliComposition.ts`, sustituye:

```ts
import { UnderpassCli } from "../adapters/inbound/cli/UnderpassCli.ts";
import { BootstrapMadeAuthorization } from "../application/use-cases/BootstrapMadeAuthorization.ts";
```

por:

```ts
import { UnderpassCli } from "../adapters/inbound/cli/UnderpassCli.ts";
import { SqliteMadePolicyCensus } from "../adapters/outbound/sqlite/SqliteMadePolicyCensus.ts";
import { BootstrapMadeAuthorization } from "../application/use-cases/BootstrapMadeAuthorization.ts";
```

En `src/composition/CliComposition.ts`, sustituye:

```ts
      connect, new VerifyServerProfiles(ToolProfiles.standard()), new DiscoverMadeCapabilities(), pins.pi.version,
      eventLog.diagnosis());

```

por:

```ts
      connect, new VerifyServerProfiles(ToolProfiles.standard()), new DiscoverMadeCapabilities(), pins.pi.version,
      eventLog.diagnosis(), eventLog.madeAuthorization(new SqliteMadePolicyCensus(), store));

```

`src/application/dto/SessionMadeDto.ts`:

```ts
// S3a en /underpass-status: grants del host vigentes en la sesión y confirmaciones pedidas.
export type SessionMadeDto = { activeGrants: number; confirmations: number };
```

`src/application/use-cases/ReadMadeStatus.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import type { SessionMadeDto } from "../dto/SessionMadeDto.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";

// La línea `made:` de /underpass-status: sólo el stream de la sesión y el del host.
export class ReadMadeStatus {
  readonly #events: EventStore; readonly #clock: Clock;
  constructor(events: EventStore, clock: Clock) { this.#events = events; this.#clock = clock; }
  execute(session: SessionId): SessionMadeDto {
    const ledger = MadeGrantLedger.forSession(this.#events, session);
    return { activeGrants: ledger.live(session, this.#clock.now()).length, confirmations: ledger.confirmations(session) };
  }
}
```

En `src/application/dto/SessionStatusDto.ts`, sustituye:

```ts
import type { QualityKpisDto } from "./QualityKpisDto.ts";
import type { SessionSummaryDto } from "./SessionSummaryDto.ts";
```

por:

```ts
import type { QualityKpisDto } from "./QualityKpisDto.ts";
import type { SessionMadeDto } from "./SessionMadeDto.ts";
import type { SessionSummaryDto } from "./SessionSummaryDto.ts";
```

En `src/application/dto/SessionStatusDto.ts`, sustituye:

```ts
// eventos cuenta como íntegra), sus KPIs y el estado del exportador OTLP. kpis y exporter
// son opcionales: un host de una versión anterior no los envía; learning (L1), igual.
export type SessionStatusDto = {
```

por:

```ts
// eventos cuenta como íntegra), sus KPIs y el estado del exportador OTLP. kpis y exporter
// son opcionales: un host de una versión anterior no los envía; learning (L1) y made (S3a), igual.
export type SessionStatusDto = {
```

En `src/application/dto/SessionStatusDto.ts`, sustituye:

```ts
  learning?: LearningStatusDto;
};
```

por:

```ts
  learning?: LearningStatusDto;
  made?: SessionMadeDto;
};
```

En `src/application/use-cases/ReadSessionStatus.ts`, sustituye:

```ts
import type { ReadLearningStatus } from "./ReadLearningStatus.ts";
import type { ReadSessionSummary } from "./ReadSessionSummary.ts";
```

por:

```ts
import type { ReadLearningStatus } from "./ReadLearningStatus.ts";
import type { ReadMadeStatus } from "./ReadMadeStatus.ts";
import type { ReadSessionSummary } from "./ReadSessionSummary.ts";
```

En `src/application/use-cases/ReadSessionStatus.ts`, sustituye:

```ts
  readonly #kpis: QualityKpisReport | null; readonly #exporter: (() => ExporterStatusDto) | null; readonly #learning: ReadLearningStatus | null;
  constructor(events: EventStore, summaries: ReadSessionSummary, kpis: QualityKpisReport | null = null, exporter: (() => ExporterStatusDto) | null = null,
    learning: ReadLearningStatus | null = null) {
    this.#events = events; this.#summaries = summaries; this.#kpis = kpis; this.#exporter = exporter; this.#learning = learning;
  }
```

por:

```ts
  readonly #kpis: QualityKpisReport | null; readonly #exporter: (() => ExporterStatusDto) | null; readonly #learning: ReadLearningStatus | null;
  readonly #made: ReadMadeStatus | null;
  constructor(events: EventStore, summaries: ReadSessionSummary, kpis: QualityKpisReport | null = null, exporter: (() => ExporterStatusDto) | null = null,
    learning: ReadLearningStatus | null = null, made: ReadMadeStatus | null = null) {
    this.#events = events; this.#summaries = summaries; this.#kpis = kpis; this.#exporter = exporter; this.#learning = learning; this.#made = made;
  }
```

En `src/application/use-cases/ReadSessionStatus.ts`, sustituye:

```ts
    if (this.#learning !== null) status.learning = this.#learning.execute(id);
    return status;
```

por:

```ts
    if (this.#learning !== null) status.learning = this.#learning.execute(id);
    if (this.#made !== null) status.made = this.#made.execute(id);
    return status;
```

En `src/composition/HostComposition.ts`, sustituye:

```ts
import { ReadLearningStatus } from "../application/use-cases/ReadLearningStatus.ts";
import { ReadSessionSummary } from "../application/use-cases/ReadSessionSummary.ts";
```

por:

```ts
import { ReadLearningStatus } from "../application/use-cases/ReadLearningStatus.ts";
import { ReadMadeStatus } from "../application/use-cases/ReadMadeStatus.ts";
import { ReadSessionSummary } from "../application/use-cases/ReadSessionSummary.ts";
```

En `src/composition/HostComposition.ts`, sustituye:

```ts
    const status = new ReadSessionStatus(events, new ReadSessionSummary(projectionStore, () => runner.runOnce()), new QualityKpisReport(projectionStore),
      () => telemetry?.status() ?? { state: "disabled", lag: 0, since: null }, new ReadLearningStatus(projectionStore));
    // L1: el host decide con el estado del bandit y registra tools.selected (spec §7).
```

por:

```ts
    const status = new ReadSessionStatus(events, new ReadSessionSummary(projectionStore, () => runner.runOnce()), new QualityKpisReport(projectionStore),
      () => telemetry?.status() ?? { state: "disabled", lag: 0, since: null }, new ReadLearningStatus(projectionStore), new ReadMadeStatus(events, clock));
    // L1: el host decide con el estado del bandit y registra tools.selected (spec §7).
```

En `src/adapters/inbound/pi/HostExtension.ts`, sustituye:

```ts
            if (l) lines.push(`learning: ${l.mode} · ${l.selected ?? "-"}/${l.candidates ?? "-"} tools · miss ${pct(l.missRate)}`);
          } catch { lines.push("session: summary unavailable"); }
```

por:

```ts
            if (l) lines.push(`learning: ${l.mode} · ${l.selected ?? "-"}/${l.candidates ?? "-"} tools · miss ${pct(l.missRate)}`);
            const m = status.made;
            if (m) lines.push(`made: ${m.activeGrants} active grants · ${m.confirmations} confirmations`);
          } catch { lines.push("session: summary unavailable"); }
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/DiagnoseMadeAuthorization.test.ts tests/unit/application/use-cases/DiagnoseInstallationMadeAuth.test.ts tests/unit/adapters/inbound/pi/made-status.test.ts tests/unit/composition/EventLogCompositionMade.test.ts` y después `npm test`.

Expected: 7 tests nuevos en verde; `npm test` en verde (632 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/diagnosis/CheckSection.ts src/application/ports/MadePolicyCensus.ts src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts src/application/use-cases/DiagnoseMadeAuthorization.ts src/application/use-cases/DiagnoseInstallation.ts src/composition/EventLogComposition.ts src/composition/CliComposition.ts src/application/dto/SessionMadeDto.ts src/application/use-cases/ReadMadeStatus.ts src/application/dto/SessionStatusDto.ts src/application/use-cases/ReadSessionStatus.ts src/composition/HostComposition.ts src/adapters/inbound/pi/HostExtension.ts tests/unit/application/use-cases/DiagnoseMadeAuthorization.test.ts tests/unit/application/use-cases/DiagnoseInstallationMadeAuth.test.ts tests/unit/adapters/inbound/pi/made-status.test.ts tests/unit/composition/EventLogCompositionMade.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(s3a): sección [made-auth] de doctor y línea made: en /underpass-status"
```

---

### Task 11: Contrato con `made-mcp` 0.8.0 real a través del host

§7, integración. `tests/fixtures/made-host.ts` arranca el host de verdad (`HostComposition.run`) con el `made-mcp` de `UNDERPASS_MADE_MCP_BIN` sobre el store y la configuración que resuelve el entorno, y el servidor falso como KMP. El contrato crea una instalación aislada (HOME, XDG y proyecto temporales; configuración privada y política sembradas como `underpass setup`: `EnsureMadeConfiguration` y `bootstrap-authorization`), habla con el host por su socket como lo haría la extensión y comprueba:

1. sin contexto, la denegación original;
2. diseñar, validar, explicar y `list_contracts` se conceden solos (auto) y funcionan; fuera de fase, no;
3. publicar sin token devuelve `needs_confirmation` con `definition s3a_contract v1.0`; con el token, publica;
4. un rechazo queda registrado y no publica;
5. los hechos: cinco `made.grant_issued` con la acción, el tipo de alcance y la clase esperados, dos `made.confirmation` (accepted, declined), y ningún hecho lleva el YAML;
6. al registrar `session.closed`, los cinco grants quedan revocados en MADE y en el log (`host`, `session_closed`);
7. en otro arranque, el host revoca el grant que dejó vivo un host anterior de una sesión que se cerró con él caído.

La política se lee con `made_get_authorization_policy`, que el dueño puede leer sin grants (y que nunca se concede al modelo: es never).

**Files:**
- Create: `tests/fixtures/made-host.ts`, `tests/contract/made-authorization.contract.test.ts`

- [ ] **Step 1: Fixture y contrato**

`tests/fixtures/made-host.ts`:

```ts
#!/usr/bin/env node
// Host real de pi-runtime (HostComposition) con el made-mcp de UNDERPASS_MADE_MCP_BIN sobre el
// store y la configuración que resuelva el entorno (XDG_STATE_HOME, XDG_CONFIG_HOME temporales)
// y el servidor MCP falso como KMP. Lo usa el contrato de S3a.
import { HostComposition } from "../../src/composition/HostComposition.ts";
import { StatePaths } from "../../src/composition/StatePaths.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { LazyMadeServerCommandFactory } from "../../src/adapters/outbound/process/LazyMadeServerCommandFactory.ts";
import type { ServerCommandFactory } from "../../src/application/ports/ServerCommandFactory.ts";

const bin = process.env.UNDERPASS_MADE_MCP_BIN;
if (!bin) throw new Error("UNDERPASS_MADE_MCP_BIN is required by made-host.ts");
const paths = new StatePaths(process.env);
const fake = new URL("./fake-mcp-server.ts", import.meta.url).pathname;
const commands = new Map<string, ServerCommandFactory>([
  ["kmp", { commandFor: (p) => ({ command: process.execPath, args: [fake], cwd: p.root.value, env: { ...process.env, FAKE_FLAVOR: "kmp" } }) }],
  ["made", new LazyMadeServerCommandFactory(bin, paths.madeStore(), new FsMadeConfigurationRepository(paths.madeConfigRoot()), process.env)],
]);
await HostComposition.run(process.argv[2] ?? process.cwd(), process.env, commands);
```

`tests/contract/made-authorization.contract.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MADE_BIN } from "./support.ts";
import { NodeEntropySource } from "../../src/adapters/outbound/crypto/NodeEntropySource.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { GitProjectLocator } from "../../src/adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { SqliteDatabase } from "../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SystemClock } from "../../src/adapters/outbound/clock/SystemClock.ts";
import type { CallContextDto } from "../../src/application/dto/CallContextDto.ts";
import { HostCallError } from "../../src/application/ports/HostCallError.ts";
import { EnsureMadeConfiguration } from "../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { RecordFact } from "../../src/application/use-cases/RecordFact.ts";
import { StatePaths } from "../../src/composition/StatePaths.ts";
import { SessionId } from "../../src/domain/events/SessionId.ts";
import { StreamId } from "../../src/domain/events/StreamId.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../src/domain/mcp/ToolName.ts";
import { fact } from "../support/recordFixtures.ts";

const skip = !MADE_BIN && "UNDERPASS_MADE_MCP_BIN not set";
const hostEntry = new URL("../fixtures/made-host.ts", import.meta.url).pathname;
const t = (n: string) => ToolName.of(n);
const DESIGN = { name: "s3a_contract", objective: "Review a change.", required_inputs: ["brief"], outputs: ["verdict"], participants: [{ role_id: "REVIEWER" }],
  stages: [{ id: "review", owner_role_id: "REVIEWER", instructions: "Review it." }] };
const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const until = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > until) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 100)); }
};

// Instalación aislada: HOME, XDG y proyecto temporales; configuración privada y política de
// MADE sembradas como `underpass setup`. Nunca toca el store ni la configuración reales.
function install() {
  const home = mkdtempSync(join(tmpdir(), "s3a-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "s3a-proj-")));
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"), UNDERPASS_HOST_IDLE_MS: "600000", UNDERPASS_MADE_MCP_BIN: MADE_BIN };
  delete env.MADE_SETUP_CONFIG_ROOT; delete env.MADE_MCP_STORE_PATH; delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const paths = new StatePaths(env);
  const store = paths.madeStore();
  mkdirSync(dirname(store.value), { recursive: true, mode: 0o700 });
  const { configuration } = new EnsureMadeConfiguration(new FsMadeConfigurationRepository(paths.madeConfigRoot()), new NodeEntropySource()).execute(store);
  execFileSync(MADE_BIN!, ["bootstrap-authorization", store.value, "--policy-id", configuration.policy.value, "--trusted-host-id", configuration.trustedHost.value]);
  const project = new GitProjectLocator().locate(cwd);
  return { home, cwd, env, socket: paths.socketOf(project), log: paths.eventLogOf(project), cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); } };
}

async function start(i: ReturnType<typeof install>): Promise<{ child: ChildProcess; gw: UnixSocketHostGateway }> {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", hostEntry, i.cwd], { env: i.env, stdio: ["ignore", "ignore", "inherit"] });
  return { child, gw: await UnixSocketHostGateway.connect(i.socket, 100, 100) };
}
async function stop(h: { child: ChildProcess; gw: UnixSocketHostGateway }): Promise<void> {
  h.gw.close();
  const exited = new Promise((r) => h.child.once("exit", r));
  h.child.kill("SIGTERM");
  await exited;
}
const record = (gw: UnixSocketHostGateway, sid: string, type: string, about: string) =>
  gw.record({ stream: "session", sessionId: sid, type, typeVersion: 1, about, occurredAtMs: Date.now(), actor: { kind: "agent", id: "pi:contract" }, payload: { reason: type === "session.closed" ? "quit" : "startup" } });
const madeFacts = (log: string) => {
  const db = SqliteDatabase.openReadOnly(log);
  try {
    const events = new SqliteEventStore(db);
    return events.streams().flatMap((s) => events.readStream(s)).filter((r) => r.type.value.startsWith("made.")).map((r) => ({ type: r.type.value, stream: r.stream.value, payload: r.payload.toValue() as Record<string, unknown> }));
  } finally { db.close(); }
};
const policy = async (gw: UnixSocketHostGateway, ctx: CallContextDto) =>
  (await gw.call(ServerName.MADE, t("made_get_authorization_policy"), {}, ctx)).structured as { policy: { grants: { grant_id: string; actions: string[] }[]; revocations: string[] } };

test("made-mcp 0.8.0 por el host real: lecturas automáticas, publicar con confirmación, rechazo, revocación al cerrar", { skip, timeout: 120_000 }, async () => {
  const i = install();
  const h = await start(i);
  try {
    const ctx: CallContextDto = { sessionId: "s1", phase: "design" };
    await record(h.gw, "s1", "session.opened", "o");

    // Sin contexto (una extensión anterior) nada cambia: la denegación original de MADE.
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_list_contracts"), {}), (e) => HostCallError.is(e) && e.code === "refused" && /denied the operation/.test(e.message));

    // Diseñar, validar y explicar: auto, sin fricción.
    const designed = (await h.gw.call(ServerName.MADE, t("made_design_ceremony"), DESIGN, ctx)).structured as { definition_yaml: string; publishable: boolean };
    assert.ok(designed.publishable && designed.definition_yaml.includes("name: s3a_contract"));
    const validated = (await h.gw.call(ServerName.MADE, t("made_validate_ceremony_draft"), { definition_yaml: designed.definition_yaml }, ctx)).structured as { publishable: boolean };
    assert.equal(validated.publishable, true);
    await h.gw.call(ServerName.MADE, t("made_explain_ceremony_draft"), { definition_yaml: designed.definition_yaml }, ctx);
    assert.ok((await h.gw.call(ServerName.MADE, t("made_list_contracts"), {}, ctx)).structured, "list_contracts: alcance global, sólo esa acción");

    // Fuera de fase: la fase interactiva no expone MADE, así que no se concede nada nuevo.
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_diff_ceremony_definitions"), { before: { definition_yaml: designed.definition_yaml }, after: { definition_yaml: designed.definition_yaml } },
      { sessionId: "s1", phase: "interactive" }), (e) => HostCallError.is(e) && /denied the operation/.test(e.message));

    // Publicar: needs_confirmation; con el token, publica.
    const publish = { definition_yaml: designed.definition_yaml };
    let token = "";
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_publish_ceremony_definition"), publish, ctx), (e) => {
      if (!HostCallError.is(e) || e.code !== "needs_confirmation") return false;
      assert.deepEqual({ ...e.confirmation, token: "-" }, { token: "-", action: "publish_ceremony_definition", scopeSummary: "definition s3a_contract v1.0" });
      token = e.confirmation!.token; return true;
    });
    const published = (await h.gw.call(ServerName.MADE, t("made_publish_ceremony_definition"), publish, { ...ctx, confirmation: token })).structured as { outcome: string };
    assert.equal(published.outcome, "published");

    // Otra definición: el usuario rechaza; nada se publica y queda registrado.
    const other = { definition_yaml: designed.definition_yaml.replace("name: s3a_contract", "name: s3a_declined") };
    await assert.rejects(h.gw.call(ServerName.MADE, t("made_publish_ceremony_definition"), other, ctx), (e) => HostCallError.is(e) && (token = e.confirmation?.token ?? "") !== "");
    assert.deepEqual(await h.gw.confirmation(SessionId.of("s1"), token, "declined"), { recorded: true });

    const facts = madeFacts(i.log);
    const issued = facts.filter((f) => f.type === "made.grant_issued").map((f) => [f.payload.action, (f.payload.scope as { kind: string }).kind, f.payload.class]);
    assert.deepEqual(issued, [["design_ceremony", "global", "auto"], ["validate_ceremony_draft", "definition", "auto"], ["explain_ceremony_draft", "definition", "auto"],
      ["list_contracts", "global", "auto"], ["publish_ceremony_definition", "definition", "confirm"]]);
    assert.deepEqual(facts.filter((f) => f.type === "made.confirmation").map((f) => [f.payload.scopeSummary, f.payload.outcome]),
      [["definition s3a_contract v1.0", "accepted"], ["definition s3a_declined v1.0", "declined"]]);
    assert.ok(!JSON.stringify(facts).includes("Review it."), "ningún hecho lleva el YAML ni las instrucciones");
    const live = (await policy(h.gw, ctx)).policy;
    assert.equal(live.grants.length, 5);
    assert.deepEqual(live.revocations, []);

    // Cierre de la sesión: el host revoca sus grants y lo registra.
    await record(h.gw, "s1", "session.closed", "c");
    await waitFor(() => madeFacts(i.log).filter((f) => f.type === "made.grant_revoked").length === 5);
    assert.deepEqual(new Set(madeFacts(i.log).filter((f) => f.type === "made.grant_revoked").map((f) => `${f.stream} ${f.payload.session} ${f.payload.reason}`)), new Set(["host s1 session_closed"]));
    await record(h.gw, "s2", "session.opened", "o");
    assert.deepEqual((await policy(h.gw, { sessionId: "s2", phase: "design" })).policy.revocations.sort(), live.grants.map((g) => g.grant_id).sort());
  } finally { await stop(h); i.cleanup(); }
});

test("made-mcp 0.8.0: al arrancar, el host revoca los grants que dejó vivos otro host de una sesión ya cerrada", { skip, timeout: 120_000 }, async () => {
  const i = install();
  let h = await start(i);
  try {
    const ctx: CallContextDto = { sessionId: "s1", phase: "design" };
    await record(h.gw, "s1", "session.opened", "o");
    await h.gw.call(ServerName.MADE, t("made_list_contracts"), {}, ctx);
    await stop(h);
    // Pi cerró la sesión con el host caído: el cierre llega al log sin pasar por el host.
    const db = SqliteDatabase.open(i.log);
    new RecordFact(new SqliteEventStore(db), new SystemClock()).execute(fact("session.closed", "late", { reason: "quit" }, StreamId.session(SessionId.of("s1")), Date.now()));
    db.close();
    h = await start(i);
    await waitFor(() => madeFacts(i.log).some((f) => f.type === "made.grant_revoked"));
    const revoked = madeFacts(i.log).filter((f) => f.type === "made.grant_revoked");
    assert.deepEqual(revoked.map((f) => f.payload.reason), ["session_closed"]);
    await record(h.gw, "s2", "session.opened", "o");
    assert.deepEqual((await policy(h.gw, { sessionId: "s2", phase: "design" })).policy.revocations, [revoked[0].payload.grantId]);
  } finally { await stop(h); i.cleanup(); }
});
```

- [ ] **Step 2: Ejecutar el contrato con el binario fijado**

Run:

```bash
UNDERPASS_MADE_MCP_BIN=$HOME/.local/share/pi-runtime/bin/made-mcp-0.8.0 \
  node --disable-warning=ExperimentalWarning --test --test-reporter=spec tests/contract/made-authorization.contract.test.ts
UNDERPASS_KMP_MCP_BIN=$HOME/.local/share/pi-runtime/bin/kmp-mcp-0.24.0 UNDERPASS_MADE_MCP_BIN=$HOME/.local/share/pi-runtime/bin/made-mcp-0.8.0 npm run test:contract
npm test
```

Expected: los 2 tests del contrato de S3a en verde (en torno a un segundo cada uno); `npm run test:contract`, 6 de 6; `npm test` sin cambios (632). Sin `UNDERPASS_MADE_MCP_BIN` el contrato se salta. Nada fuera de los temporales: ni `~/.local/state/underpass-made` ni `~/.config/underpass-made`.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/made-host.ts tests/contract/made-authorization.contract.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "test(s3a): contrato con made-mcp 0.8.0 real a través del host"
```

---

### Task 12: Documentación — README e issues de MADE

§6 y la documentación de uso. Los tres issues para `underpass-ai/made` quedan redactados en `docs/upstream/2026-09-30-made-s3a-issues.md` (en inglés, como el repositorio de MADE) y **no se abren**: los abre Tirso. El segundo se reescribe respecto a la spec: en 0.8.0 `made_get_help` no queda denegada, se responde antes de la autorización (comprobado); lo que falta es documentarlo. El README explica la autorización de MADE, los comandos nuevos y que S3a también es un cambio de un solo sentido en el log (y que desde S3a los lectores toleran tipos futuros).

**Files:**
- Create: `docs/upstream/2026-09-30-made-s3a-issues.md`
- Modify: `README.md`

- [ ] **Step 1: Escribir**

`docs/upstream/2026-09-30-made-s3a-issues.md`:

```markdown
# Issues para `underpass-ai/made` que abre S3a

- **Fecha:** 2026-09-30
- **Contexto:** `docs/specs/2026-09-30-s3a-made-authorization-design.md` §0.4 y §6.
- **Estado:** borradores. Los abre Tirso; este documento no se usa para abrirlos.

Los textos van en inglés, como el resto del repositorio de MADE. Cada uno cita lo comprobado
con `made-mcp` 0.8.0 en modo embebido sobre un store temporal.

---

## 1. Narrower authorization scopes for `design_ceremony`, `list_contracts` and `diff_ceremony_definitions`

**Title:** `Embedded authorization: definition/contract scopes for design_ceremony, list_contracts and diff_ceremony_definitions`

**Body:**

> In embedded mode, `scope_for_tool` (`crates/made-mcp/src/embedded/embedded_tool_authorizer.rs`)
> falls back to `AuthorizationScope::Global` for every tool that names no resource field.
> Three read/draft tools end up there:
>
> - `made_design_ceremony` takes a `name` for the draft it designs, but is not in
>   `is_definition_action`, so its decision is `{"kind":"global"}`.
> - `made_list_contracts` takes no arguments and reads the contract registry.
> - `made_diff_ceremony_definitions` names two definitions (`before`/`after`, by
>   `ceremony` + `version` or by `definition_yaml`) and still resolves to `global`.
>
> A host that grants exact decisions (pi-runtime S3a) therefore has to issue a
> `global` grant, limited to that single action, to let a model design or compare a
> definition. We would like:
>
> 1. `design_ceremony` scoped as `definition { name, version: null }` from its `name`.
> 2. `diff_ceremony_definitions` scoped by the `after` definition (or both), like
>    `validate_ceremony_draft`.
> 3. A `contract` (or registry) scope for `list_contracts`, or a documented statement
>    that the registry is intentionally global.
>
> Verified with 0.8.0: `made_list_contracts {}` is denied with a decision whose scope is
> `{"kind":"global"}`; after a grant of `list_contracts` on `global`, it succeeds.

## 2. Document which tools bypass authorization (`made_get_help`)

**Title:** `Document that made_get_help (and discovery) are answered before the authorization gate`

**Body:**

> `made_get_help` has no `AuthorizationAction`: `server.rs` answers it before the
> backend, so it is never authorized. That is reasonable for help text, but it is not
> documented, and hosts cannot tell from the catalog which tools are gated. With 0.8.0
> embedded and an empty policy, `made_get_help {"audience":"agent"}` succeeds while
> `made_get_status` is denied.
>
> Please document (in the tool descriptions or in `made_discover_capabilities`) which
> tools are served without authorization, so a host can avoid asking for grants it
> does not need, and so the list is part of the contract.

## 3. A human principal distinct from the trusted host in embedded mode

**Title:** `Embedded mode: allow a second (human) principal so approvals can be used`

**Body:**

> In embedded mode every call runs as the single principal `MADE_AUTH_TRUSTED_HOST_ID`,
> which is also the policy owner. `made_approve_authorization_operation` therefore
> cannot be used: the separation rule requires the approver to differ from the
> executor, and there is only one identity. pi-runtime works around it by asking the
> person in its own TUI and then issuing a five-minute exact grant as the owner.
>
> Long term we would like the embedded host to be able to present a second, human
> principal (for example, configured next to the trusted host id and authenticated by
> the local host), so the native approval flow, with its decision and evidence, can
> record who approved a write. Out of scope for pi-runtime S3a; filed for later.
```

En `README.md`, sustituye:

```markdown
| KMP | Memory: durable facts, relations, validity, provenance, labels |
| Host | Bridging: one deterministic process per project that runs the MCP servers and hands their tools to Pi. It keeps no state machine, budget, authorization or validator of its own. |

```

por:

```markdown
| KMP | Memory: durable facts, relations, validity, provenance, labels |
| Host | Bridging: one deterministic process per project that runs the MCP servers and hands their tools to Pi. It keeps no state machine, budget or validator of its own, and never decides authorization: MADE does, and the host only asks it for exact, audited grants. |

```

En `README.md`, sustituye:

```markdown

### OTLP export (optional)
```

por:

```markdown

### MADE authorization

`made-mcp` runs embedded with a single principal, the trusted host, which owns the
authorization policy. When MADE denies a call, the host reads the decision (the
exact action and scope) and acts on its class:

- **Reads and drafts** (`design_ceremony`, `validate_ceremony_draft`,
  `explain_ceremony_draft`, `diff_ceremony_definitions`, `list_contracts`…) are
  granted on their own, for that exact action and scope, until the session closes
  (12 h at most), and the call is retried once.
- **Writes** (`publish_ceremony_definition`, starting or advancing ceremonies…)
  ask for confirmation in Pi's TUI; if you accept, the host grants that one action
  for five minutes. Without a UI (`pi -p`) they are refused.
- **Authorization admin** tools are never granted to the model, and nothing is
  granted for a tool the current phase does not expose.

Grants are revoked when the session closes; a host that starts revokes those a
previous one left behind. `node bin/underpass.ts made grants` lists them and
`made revoke-orphans` cleans up by hand. `doctor` checks it under `[made-auth]` and
`/underpass-status` shows `made: <n> active grants · <m> confirmations`. Every grant,
revocation and confirmation is a fact in the project's event log.

Like tool learning, this adds fact types (`made.grant_issued`, `made.grant_revoked`,
`made.confirmation`) that versions before it cannot read. From this version on,
the log readers keep fact types they do not know as opaque records, so later
versions can add types without breaking this one.

### OTLP export (optional)
```

En `README.md`, sustituye:

```markdown
- S1 acceptance on a real installation: [`docs/acceptance/s1.md`](docs/acceptance/s1.md)

```

por:

```markdown
- S1 acceptance on a real installation: [`docs/acceptance/s1.md`](docs/acceptance/s1.md)
- S3a (host-managed MADE authorization): [spec](docs/specs/2026-09-30-s3a-made-authorization-design.md), [plan](docs/plans/2026-09-30-s3a-made-authorization.md), [MADE issues](docs/upstream/2026-09-30-made-s3a-issues.md)

```

- [ ] **Step 2: Comprobar**

Run: `npm test` y `git diff --stat`.

Expected: en verde (632); sólo cambian `README.md` y el documento nuevo.

- [ ] **Step 3: Commit**

```bash
git add docs/upstream/2026-09-30-made-s3a-issues.md README.md
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "docs(s3a): README e issues de MADE para S3a"
```

---

### Task 13: Aceptación de S3a en la instalación real

**Files:**
- Create: `tests/acceptance/made-auth-session.ts`, `docs/acceptance/s3a.md`

**Montaje.** Pi carga el paquete `pi-runtime` desde el checkout principal `~/Documents/ai/pi-runtime`, registrado en `~/.pi/agent/settings.json`. **Ese fichero no se toca y no se ejecuta `underpass update`.** Para usar el código de S3a por el camino del operador (CLI, `doctor` y el vistazo de la TUI), el checkout principal se pone en `--detach` en el HEAD de `feat/s3a-made-auth` y se devuelve a su rama al final (la técnica de L1 Task 12). El worktree `~/Documents/ai/pi-runtime-s3a` no se toca.

**Aislamiento.** Todo corre en un proyecto temporal con `XDG_STATE_HOME`, `MADE_SETUP_CONFIG_ROOT` y `KMP_MCP_DATA_DIR` temporales (en el scratchpad de la sesión, `$ACC`, con directorios `0700`): el log de eventos, el socket del host, el store de MADE (`$ACC/state/underpass-made/ceremonies.sqlite3`), su configuración privada y los datos de KMP son desechables. **Nunca** se usa el store real `~/.local/state/underpass-made` ni `~/.config/underpass-made`, y por eso no hace falta copiar ni restaurar ningún log real. Mientras el checkout principal esté en S3a no puede haber otra sesión de Pi abierta: una sesión real con el código de S3a emitiría grants contra el store real de MADE y escribiría hechos `made.*` que el código anterior no lee.

- [ ] **Step 1: Script de la sesión de aceptación**

`tests/acceptance/made-auth-session.ts`:

```ts
#!/usr/bin/env node
// Uso: S3A_CONFIRM=accept|decline node tests/acceptance/made-auth-session.ts <proyecto> [nombre=pr_review_two_reviewers]
//
// Aceptación de S3a (spec §7): una sesión real de Pi por el SDK, con el modelo sustituido por
// el proveedor `faux` de pi-ai (sin red), las extensiones de ESTE checkout y el host real del
// proyecto con made-mcp real. Debe correr con XDG_STATE_HOME, MADE_SETUP_CONFIG_ROOT y
// KMP_MCP_DATA_DIR temporales (store y configuración de MADE sembrados con made-config.ts):
//  1. /underpass-phase design;
//  2. una petición en la que el modelo faux diseña, valida y explica la definición, y la publica;
//  3. la confirmación de la TUI responde según S3A_CONFIRM (y se cuenta cuántas veces se pide);
//  4. /underpass-status por el comando registrado;
//  5. cierre como AgentSessionRuntime.dispose() (el host revoca los grants de la sesión).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

for (const v of ["XDG_STATE_HOME", "MADE_SETUP_CONFIG_ROOT", "KMP_MCP_DATA_DIR"]) {
  if (!process.env[v]) { console.error(`set ${v} to a throwaway directory: this acceptance never touches the real stores`); process.exit(2); }
}
const prefix = process.env.PI_RUNTIME_PREFIX ?? join(process.env.HOME!, ".local/share/pi-runtime/pi-0.87.1");
const pkgDir = join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent");
const main = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entry = typeof main.exports === "string" ? main.exports : main.exports?.["."]?.import ?? main.exports?.["."]?.default ?? main.main;
const sdk = await import(pathToFileURL(join(pkgDir, entry)).href);
const ai = await import(pathToFileURL(join(pkgDir, "node_modules/@earendil-works/pi-ai/dist/compat.js")).href);
const root = new URL("../../", import.meta.url).pathname;
const cwd = process.argv[2] ?? process.cwd();
const name = process.argv[3] ?? "pr_review_two_reviewers";
const accept = (process.env.S3A_CONFIRM ?? "accept") === "accept";

const DESIGN = {
  name, objective: "Review a pull request with two independent reviewers and agree on a verdict.", required_inputs: ["pull_request"], outputs: ["verdict"],
  participants: [{ role_id: "REVIEWER" }], stages: [{ id: "review", owner_role_id: "REVIEWER", instructions: "Review the change independently.", num_agents: 2 }],
};
type Result = { role: string; toolName?: string; isError?: boolean; details?: { definition_yaml?: string }; content?: { type: string; text?: string }[] };
const results = (context: { messages: Result[] }) => context.messages.filter((m) => m.role === "toolResult");
const yaml = (context: { messages: Result[] }) => results(context).find((m) => m.toolName === "made_design_ceremony")?.details?.definition_yaml ?? "";
const call = (tool: string, args: (c: { messages: Result[] }) => Record<string, unknown>, id: string) =>
  (c: { messages: Result[] }) => ai.fauxAssistantMessage(ai.fauxToolCall(tool, args(c), { id }), { stopReason: "toolUse" });
let outcomes: { tool: string; error: boolean; head: string }[] = [];

const faux = ai.fauxProvider({ provider: "s3a-faux", models: [{ id: "s3a-faux-model" }] });
const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd, agentDir: sdk.getAgentDir(), settingsManager, noExtensions: true,
  additionalExtensionPaths: ["host", "kmp", "made"].map((e) => join(root, "src/adapters/inbound/pi/entry", `${e}.ts`)),
});
await resourceLoader.reload();
const loaded = resourceLoader.getExtensions();
if (loaded.errors.length) { console.error(loaded.errors); process.exit(1); }
const { session } = await sdk.createAgentSession({ cwd, resourceLoader, settingsManager, model: faux.getModel(), sessionManager: sdk.SessionManager.inMemory(cwd) });
session.modelRuntime.registerNativeProvider(faux.provider);
await session.modelRuntime.setRuntimeApiKey("s3a-faux", "faux");
const notes: string[] = []; const asked: string[] = [];
const noop = () => undefined;
const uiContext: Record<string, unknown> = Object.fromEntries(["addAutocompleteProvider", "custom", "editor", "getEditorText", "input", "onTerminalInput", "pasteToEditor", "select", "setEditorText", "setFooter", "setHeader", "setHiddenThinkingLabel", "setStatus", "setTitle", "setWidget", "setWorkingIndicator", "setWorkingMessage", "setWorkingVisible"].map((key) => [key, noop]));
uiContext.notify = (m: string) => { notes.push(String(m)); };
uiContext.confirm = async (title: string, message: string) => { asked.push(`${title} | ${message}`); return accept; };
const extensionErrors: string[] = [];
await session.bindExtensions({ uiContext, onError: (e: { error: string; event: string }) => extensionErrors.push(`${e.event}: ${e.error}`) });
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !session.getAllTools().some((t: { name: string }) => t.name === "made_publish_ceremony_definition")) await new Promise((r) => setTimeout(r, 200));

await session.prompt("/underpass-phase design");
faux.setResponses([
  call("made_design_ceremony", () => DESIGN, "s3a1"),
  call("made_validate_ceremony_draft", (c) => ({ definition_yaml: yaml(c) }), "s3a2"),
  call("made_explain_ceremony_draft", (c) => ({ definition_yaml: yaml(c) }), "s3a3"),
  call("made_publish_ceremony_definition", (c) => ({ definition_yaml: yaml(c) }), "s3a4"),
  (c: { messages: Result[] }) => {
    outcomes = results(c).map((m) => ({ tool: m.toolName ?? "?", error: m.isError === true, head: (m.content ?? []).map((x) => x.text ?? "").join("").slice(0, 120) }));
    return ai.fauxAssistantMessage("done");
  },
]);
await session.prompt(`design, validate, explain and publish ${name}`);
await session.prompt("/underpass-status");
const sid = session.sessionManager.getSessionId();
await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
session.dispose();

const by = (tool: string) => outcomes.find((o) => o.tool === tool);
const made = notes.join("\n").split("\n").find((l) => l.startsWith("made: ")) ?? null;
const publish = by("made_publish_ceremony_definition");
const checks = {
  designed: by("made_design_ceremony")?.error === false,
  validated: by("made_validate_ceremony_draft")?.error === false,
  explained: by("made_explain_ceremony_draft")?.error === false,
  askedOnce: asked.length === 1 && asked[0].startsWith("MADE: publish_ceremony_definition | definition "),
  publish: accept ? publish?.error === false : publish?.error === true && /needs_confirmation_declined/.test(publish.head),
  statusMadeLine: made !== null,
  noExtensionErrors: extensionErrors.length === 0,
};
console.log(JSON.stringify({ sessionId: sid, confirm: accept ? "accept" : "decline", asked, outcomes, made, extensionErrors, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
```

Commit en el worktree:

```bash
cd /home/gx10a/Documents/ai/pi-runtime-s3a
git add tests/acceptance/made-auth-session.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "test(s3a): script de aceptación de la autorización de MADE"
```

- [ ] **Step 2: Tests, montaje aislado y checkout principal en S3a**

```bash
cd /home/gx10a/Documents/ai/pi-runtime-s3a && npm test
pgrep -af 'pi( |$)' | grep -v pgrep || true                     # ninguna sesión de Pi abierta
ACC=<scratchpad de la sesión>/s3a-acceptance
mkdir -p -m 700 "$ACC" && mkdir -m 700 "$ACC/state" "$ACC/madecfg" "$ACC/kmp" "$ACC/proj"
git -C "$ACC/proj" init -q
export XDG_STATE_HOME="$ACC/state" MADE_SETUP_CONFIG_ROOT="$ACC/madecfg" KMP_MCP_DATA_DIR="$ACC/kmp"
git -C /home/gx10a/Documents/ai/pi-runtime status --short          # vacío: el checkout principal está limpio
ORIG=$(git -C /home/gx10a/Documents/ai/pi-runtime branch --show-current); echo "$ORIG"
S3A=$(git -C /home/gx10a/Documents/ai/pi-runtime-s3a rev-parse HEAD)
git -C /home/gx10a/Documents/ai/pi-runtime checkout --detach "$S3A"
cd /home/gx10a/Documents/ai/pi-runtime && node tests/acceptance/made-config.ts
```

Expected: `npm test` en verde; `made config created` y `authorization bootstrap OK` (sobre el store temporal; el script nunca imprime la configuración); `ORIG` es la rama en la que estaba el checkout principal.

- [ ] **Step 3: `doctor` antes de ninguna sesión**

```bash
cd "$ACC/proj" && node /home/gx10a/Documents/ai/pi-runtime/bin/underpass.ts doctor | sed -n '/\[made-auth\]/,/^\[/p'
```

Expected:

```text
[made-auth]
  OK   host authorization — the host owns the MADE policy and can grant exact actions
  OK   orphan grants — none
  OK   shared store — only pi-runtime's policy
```

(El resto de `doctor` puede avisar de lo propio de un estado recién creado, p. ej. que aún no hay eventos; ningún FAIL.)

- [ ] **Step 4: Sesión con la confirmación aceptada**

```bash
cd /home/gx10a/Documents/ai/pi-runtime
S3A_CONFIRM=accept node tests/acceptance/made-auth-session.ts "$ACC/proj" > "$ACC/accept.json"; echo "exit $?"
node -e 'const j=require(process.argv[1]); console.log(JSON.stringify(j.checks), j.asked, j.made, j.outcomes.map((o) => `${o.tool}:${o.error ? "error" : "ok"}`).join(" "))' "$ACC/accept.json"
sleep 2; cd "$ACC/proj" && node /home/gx10a/Documents/ai/pi-runtime/bin/underpass.ts made grants
```

Expected: `exit 0` y todos los checks en `true`:
- diseñar, validar y explicar `pr_review_two_reviewers` sin fricción (`made_design_ceremony:ok`, `made_validate_ceremony_draft:ok`, `made_explain_ceremony_draft:ok`);
- una sola pregunta, `MADE: publish_ceremony_definition | definition pr_review_two_reviewers v1.0. Allow this call?`, y `made_publish_ceremony_definition:ok`;
- `made: 4 active grants · 1 confirmations` en `/underpass-status`;
- tras el cierre, `underpass made grants` lista los cuatro grants (tres `auto`, uno `confirm`) en estado `revoked`.

- [ ] **Step 5: Sesión con la confirmación rechazada**

```bash
cd /home/gx10a/Documents/ai/pi-runtime
S3A_CONFIRM=decline node tests/acceptance/made-auth-session.ts "$ACC/proj" pr_review_declined > "$ACC/decline.json"; echo "exit $?"
node -e 'const j=require(process.argv[1]); console.log(JSON.stringify(j.checks), j.outcomes.at(-1).head)' "$ACC/decline.json"
SID=$(node -e 'console.log(require(process.argv[1]).sessionId)' "$ACC/decline.json")
cd "$ACC/proj" && node /home/gx10a/Documents/ai/pi-runtime/bin/underpass.ts events show "$SID" > "$ACC/show.txt"
grep -c 'made\.' "$ACC/show.txt"; grep -c -e 'instructions' -e 'Review the change' -e "$HOME" "$ACC/show.txt"
```

Expected: `exit 0`; la publicación vuelve como `made_publish_ceremony_definition refused (needs_confirmation_declined): the user declined MADE publish_ceremony_definition on definition pr_review_declined v1.0`; `events show` tiene los hechos `made.grant_issued` y un `made.confirmation` con `outcome: declined`, y el segundo `grep` da 0 (ni el texto de la definición ni rutas).

- [ ] **Step 6: `doctor` en verde y huérfanos**

```bash
cd "$ACC/proj"
node /home/gx10a/Documents/ai/pi-runtime/bin/underpass.ts doctor | sed -n '/\[made-auth\]/,/^\[/p'; echo "exit ${PIPESTATUS[0]}"
node /home/gx10a/Documents/ai/pi-runtime/bin/underpass.ts made revoke-orphans
```

Expected: exit 0 con las tres líneas `OK` de `[made-auth]` (los grants de las dos sesiones ya se revocaron al cerrarlas) y `no orphan MADE grants`.

- [ ] **Step 7 (opcional, a mano): el vistazo de la TUI**

Con las mismas variables exportadas, en `$ACC/proj`: `pi`, `/underpass-phase design`, pedir «diseña, valida y publica una ceremonia `pr_review_two_reviewers` con dos revisores» con un modelo real. Diseñar y validar no preguntan; publicar abre el diálogo `MADE: publish_ceremony_definition`. `/underpass-status` termina en `made: … active grants · … confirmations`. Salir con `/quit`. (El SDK ya lo comprobó en los pasos 4 y 5; esto es el vistazo del operador.)

- [ ] **Step 8: Devolver el checkout principal y limpiar**

```bash
pgrep -af "underpass-host[.]ts $ACC/proj" || echo "sin host del proyecto temporal"
git -C /home/gx10a/Documents/ai/pi-runtime checkout "$ORIG"
git -C /home/gx10a/Documents/ai/pi-runtime status --short
unset XDG_STATE_HOME MADE_SETUP_CONFIG_ROOT KMP_MCP_DATA_DIR
```

Expected: el host del proyecto temporal ya se apagó por inactividad (si sigue vivo, esperar a que se apague: nunca `pkill -f` con un patrón que case con la propia shell); el checkout principal vuelve a `$ORIG` y queda limpio. `$ACC` se puede borrar al terminar.

- [ ] **Step 9: Registrar** en `docs/acceptance/s3a.md` el montaje (checkout en `--detach`, `settings.json` sin tocar, estado, store y configuración de MADE temporales), los comandos, las salidas relevantes recortadas y sin rutas de `$HOME`, la fecha y las versiones (pi-runtime, Pi, Node, kmp-mcp, made-mcp). Commit en el worktree:

```bash
cd /home/gx10a/Documents/ai/pi-runtime-s3a
git add docs/acceptance/s3a.md
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "docs(s3a): aceptación de la autorización de MADE en la instalación real"
```

---

## Cobertura de la spec

| Spec | Tareas |
|---|---|
| §0.1 el host es el punto de control: lee la decisión (acción y alcance exactos), grant exacto, un reintento | 2 (`MadeDecisionId`, `MadeDecision`, `MadeGrant`), 5 (`MadeOwner`, `CallMadeTool`), 11 |
| §0.2 lectura y borrador automáticos hasta el cierre de la sesión | 2 (`MadeActionPolicy`, 12 h), 5, 8 (revocación al cierre) |
| §0.3 escrituras con confirmación humana en la TUI, grant de 5 min, sin UI se deniega, sin `approve_authorization_operation` | 3, 5, 6, 7, 11, 13 |
| §0.4 excepción `global` de `design_ceremony`, `list_contracts`, `diff_ceremony_definitions`, limitada a la acción y a la sesión | 5 (el grant es el alcance exacto de la decisión, `global` para esas tres, una sola acción, revocado al cierre), 11, 12 (issue 1) |
| §0.5 auditoría en el log con hechos nuevos, lectores tolerantes antes | 1, 4 |
| §1 tres clases, tabla cerrada, desconocida confirm, never sólo del host, la fase manda | 2 (`MadeActionPolicy`, `PhaseToolSelection#exposes`), 5 |
| §2.1–2.2 flujo del host: denegación con id de decisión, lectura como dueño, auto con grant de 12 h (`grantee` = `issuer`, depth 0, sin padre) y reintento, confirm con token o `needs_confirmation {action, scopeSummary}`, never o fuera de fase: la denegación original | 2, 5, 6 |
| §2.3 caché | 5 (`IssuedGrants`, emisión compartida), 8 (se olvida al cerrar) |
| §2.4 ids deterministas | 2 (`MadeGrantId.derive`), 4 (ids de hecho por grant y por token) |
| §2.5 fallos: la denegación original, sin bucles | 5 |
| §3 confirmación en la extensión: `ctx.ui.confirm`, reenvío con token, `needs_confirmation_declined`, `needs_confirmation_no_ui`; token del host, un solo uso, 2 min, ligado a sesión, tool y digest | 3, 6, 7 |
| §4 hechos v1 (`made.grant_issued`, `made.grant_revoked`, `made.confirmation`), cierre de sesión, arranque del host, caducidad sola, lectores tolerantes | 1, 4, 8, 11 |
| §5 `doctor [made-auth]` (OK, huérfanos, store compartido), `underpass made grants`, `revoke-orphans`, `/underpass-status` | 9, 10, 13 |
| §6 issues de MADE | 12 (redactados, sin abrir) |
| §7 unitarias, integración con `made-mcp` real, extensión, aceptación | 1–10, 11, 7, 13 |
| §8 fuera de alcance | no se implementa: ni `working_session` ni grants por worker, ni segunda identidad en MADE, ni aislamiento con Underpass Runtime |

## Decisiones tomadas donde la spec deja margen

1. **Qué es una denegación (§2.2).** MADE 0.8.0 embebido no tiene un código `authorization denied`: la denegación es una negativa `refused` con el mensaje exacto `authorization decision <id> denied the operation`. Se reconoce por ese mensaje (`MadeDecisionId.fromDenial`); `… has expired` (aprobación caducada) y cualquier otra negativa vuelven tal cual.
2. **Leer la decisión (§2.2.1).** Con `after_decision_id` = id − 1 y `limit` 1, porque MADE ordena por id con cursor exclusivo: una sola llamada, sin paginar un historial que crece con cada lectura. Si no está, no es una denegación o no se lee, la denegación original.
3. **Clasificación por tool, grant por acción (§1).** La clase sale del nombre de la tool (lo que el modelo llamó y la fase expone); el grant, de la acción y el alcance de la decisión (p. ej. `get_budget_report` → `read_budget`).
4. **La fase de una llamada (§1, §2.2.4).** La envía la extensión con cada `call` (`HostExtension.callContext()`: su sesión y su fase); el host no guarda fases. Sin contexto (extensión anterior) no se concede nada. La fase manda para todas las clases, también confirm. Con las fases de S1 sólo `design` expone MADE (seis auto y `publish_ceremony_definition`); `get_status` y compañía son auto, pero ninguna fase las expone, así que el host no las concede.
5. **El beneficiario del grant.** Es el dueño de la política, leído una vez con `made_get_authorization_policy`; el host no necesita leer la configuración privada de MADE.
6. **Id de grant (§2.4).** `pi-runtime-` + 32 hex de sha256(sesión, acción, alcance canónico, instante de emisión).
7. **El token en el reintento (§3).** Con un token válido, el host no vuelve a esperar la denegación: registra la aceptación, emite el grant de 5 min con la acción y el alcance guardados al pedirla y llama una vez. Si la emisión falla, la llamada sale igual y MADE la deniega: se devuelve esa denegación, nunca otra `needs_confirmation` en la misma llamada. Cualquier presentación consume el token.
8. **Rechazo y falta de UI (§3, §4).** Método IPC nuevo `confirmation {sessionId, token, outcome}` sólo para `declined` y `no_ui`; aceptar sólo se prueba reenviando el token. Todos los `made.confirmation` los registra el host, que conoce la acción y el alcance del token. Pi no puede enviar hechos `made.*` por `record`.
9. **Stream de `made.grant_revoked` (§4).** Siempre el del host, con `session` en el payload: tras `session.closed` el stream de la sesión ya no admite hechos.
10. **Huérfanos (§4, §5).** Sin revocar y con la sesión cerrada (`session_closed`), abandonada 24 h o con el grant caducado (`expired_cleanup`). `doctor` sólo avisa de los vigentes. Al arrancar, el host revoca después de adoptar los spools y sólo arranca MADE si hay huérfanos. Un `not_found` al revocar cuenta como revocado (el grant no está en ese store).
11. **Grant sin auditar.** Si `made.grant_issued` no se puede registrar (la sesión no está abierta en el log), el grant se revoca en el acto y vuelve la denegación original.
12. **MADE no sabe de sesiones.** Un grant del trusted host sirve a todas las sesiones; revocar al cerrar una puede quitárselo a otra, que lo vuelve a obtener sola en su siguiente llamada. Se acepta: la alternativa (no revocar mientras otra sesión lo use) contradice §4.
13. **Textos de la TUI y de estado.** En inglés, como el resto de Underpass: `MADE: <acción>` / `<alcance>. Allow this call?` y `made: <n> active grants · <m> confirmations` (confirmaciones = todas las pedidas en la sesión: aceptadas, rechazadas y sin UI). Un diálogo que falla cuenta como rechazo.
14. **`doctor [made-auth]` OK (§5).** Leer la política como dueño con la conexión de MADE que `doctor` ya abre; si no se puede, FAIL (el host no podría conceder nada). El store compartido se cuenta con `authorization_policy_state` en sólo lectura.
15. **Tipos opacos (§4).** `EventType.stored` acepta cualquier `familia.nombre` bien formado; `EventType.of` sigue siendo la puerta de los hechos nuevos. Las ventanas de L1 ignoran los opacos y la auditoría de MADE.
16. **`made_get_help` (§6.2).** En 0.8.0 no se deniega: se responde antes de la autorización. El issue 2 pide documentar qué tools no pasan por la autorización.
17. **`revoke-orphans` a mano.** Actor `human` `underpass-cli`; sale con 1 si queda algún huérfano sin revocar.
18. **Aceptación (§7).** Proyecto, estado, store y configuración de MADE y datos de KMP temporales: no hace falta copiar ni restaurar ningún log real. El checkout principal sólo se pone en S3a para usar el CLI y la TUI por el camino del operador.

## Autorrevisión

- **Cobertura de la spec:** cada sección tiene tarea (tabla de arriba); §8 queda fuera a propósito.
- **Marcadores:** ningún TBD, TODO ni "igual que la tarea N"; cada paso de código lleva el fichero completo o la sustitución exacta, y cada test va entero.
- **Consistencia de tipos entre tareas:** comprobada aplicando el plan sobre una copia limpia del worktree tarea a tarea, tal como está escrito (ficheros completos y sustituciones exactas): `npm test` queda en verde tras cada tarea, gates de arquitectura incluidos. Al final, 632 tests en verde (569 antes de S3a), con cobertura global de 99,6 % de líneas, 96,8 % de ramas y 97,4 % de funciones. El contrato de la tarea 11 pasa con `made-mcp` 0.8.0 real sobre store y configuración temporales (y `npm run test:contract`, 6 de 6). `made-auth-session.ts` se probó con una sesión real de Pi por el SDK contra un host, un `made-mcp` y un `kmp-mcp` reales, en un proyecto, un `XDG_STATE_HOME`, un store y una configuración de MADE temporales (aceptada: 4 grants, una confirmación, publicado, revocados al cerrar; rechazada: `needs_confirmation_declined`; `doctor [made-auth]` en OK).
- **Tests existentes que cambian:** ninguno. Los casos nuevos van en ficheros nuevos; `EventLogCompositionMade.test.ts` (tarea 9) recibe un import y un caso más en la tarea 10.
