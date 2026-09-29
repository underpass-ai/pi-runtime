# F3 Fase `run` de MADE — Plan de implementación

**Goal:** Que desde la misma sesión de Pi en la que se diseña y publica una ceremonia se pueda
arrancarla y llevarla a su terminal: fase `run` con el mínimo medido contra `made-mcp` 0.8.0, una
sola confirmación (el arranque) y grants de alcance a la instancia para el resto, revocados al
terminal o al cerrar la sesión.

**Architecture:** El dominio añade la fase (`Phase.RUN`, `PhaseToolSelection`), la instancia
(`CeremonyId`, `CeremonySnapshot`, `CeremonyEndReason`, `StartedCeremony`), el alcance de instancia
(`MadeScope.ceremony`, `ceremonyId()`), el motivo `ceremony_ended` y, en `MadeActionPolicy`, qué es
una escritura de ejecución (`executesInstance`), qué arranca (`startsCeremony`) y qué se retiene
fuera de fase (`withheld`). La aplicación añade los hechos `made.ceremony_started` y
`made.ceremony_ended` (`MadeFactFactory`), su lectura en `MadeGrantLedger`, el ramal de instancia
propia y la observación de terminales en `CallMadeTool`, la revocación por terminal en
`RevokeMadeGrants`, y las superficies (`ReadMadeStatus`, `ListMadeCeremonies`,
`MadeCeremonyMapper`). Los adaptadores: `/underpass-phase run` y las líneas de instancia en
`/underpass-status` (`HostExtension`) y `underpass made ceremonies` (`MadeCli`). `PiToolFactory` no
cambia: la confirmación de S3a ya sirve.

**Tech Stack:** el de S3a. Sin dependencias npm.

**Spec:** `docs/specs/2026-09-30-f3-made-run-phase-design.md`.

## Global Constraints

Las de S3a (hexagonal, un tipo por fichero, VOs con constructor privado, cobertura ≥ 80 %, privacidad
de hechos y superficies, stores de MADE temporales en tests y aceptación), más:

- Los hechos nuevos son v1 y sólo llevan identidad (id de instancia, definición, versión, motivo).
- El id de un hecho nunca lleva el id de instancia en claro: lleva su huella (`CeremonyId.fingerprint`).
- Rama `feat/f3-made-run-phase` en el worktree `~/Documents/ai/pi-runtime-f3`; el checkout principal
  sólo se toca para la aceptación y se deja en `main`. `PiToolFactory` no se toca (hay otro trabajo
  en paralelo sobre él).

## Mapa de ficheros

```text
src/domain/session/Phase.ts, PhaseToolSelection.ts        (+ RUN y su tabla)
src/domain/events/EventType.ts                           (+ made.ceremony_started, made.ceremony_ended)
src/domain/made/                                          CeremonyId, CeremonyEndReason, CeremonySnapshot, StartedCeremony (nuevos);
                                                          MadeScope (+ceremony, +ceremonyId), RevocationReason (+ceremony_ended),
                                                          MadeActionPolicy (+executesInstance, +startsCeremony, +withheld)
src/application/dto/                                      MadeCeremonyDto, MadeCeremonyGrantDto (nuevos), SessionMadeDto (+ceremonies)
src/application/mappers/MadeCeremonyMapper.ts             (nuevo)
src/application/services/                                 MadeFactFactory (+2 hechos), MadeGrantLedger (+instancias)
src/application/use-cases/                                CallMadeTool (+instancia propia, +terminal, +out_of_phase, +arranque sin id),
                                                          RevokeMadeGrants (+ceremonyEnded), ReadMadeStatus (+instancias), ListMadeCeremonies (nuevo)
src/adapters/inbound/pi/HostExtension.ts                  (+run, +líneas de instancia)
src/adapters/inbound/cli/                                 MadeCli (+ceremonies), UnderpassCli (uso)
src/composition/                                          HostComposition (events y revoke a CallMadeTool), EventLogComposition (+ceremonies)
tests/support/FakeMade.ts                                 (+alcance ceremony e instancias mínimas)
tests/contract/made-host-support.ts                       (helpers del contrato de S3a, compartidos)
tests/contract/made-run.contract.test.ts                  (nuevo)
tests/acceptance/made-run-session.ts                      (nuevo)
docs/specs, docs/plans, docs/acceptance/f3.md, README.md
```

## Tareas

### Task 1: Medir el mínimo contra `made-mcp` 0.8.0

Con un store temporal y el host como dueño: diseñar, publicar y arrancar una definición mínima,
recorrer `claim`/`complete`/`apply_transition`, anotar por cada llamada la acción y el alcance de la
decisión que la deniega y si hace falta grant. Resultado (spec §1): alcance `ceremony {ceremony_id}`
para `start`, `get_ceremony_instance`, `claim`, `apply_transition`, `renew`, `bind`, `cancel`,
transcript y eventos; `global` para `start` sin `ceremony_id` (inadmisible); `complete` sin grant
propio; `renew` exige la autorización de la reclamación viva; el terminal es `lifecycle: ended`.

### Task 2: Dominio

`Phase.RUN` y su tabla; VOs de instancia; `MadeScope.ceremony`; motivo `ceremony_ended`; tipos de
hecho; `MadeActionPolicy` (`executesInstance`, `startsCeremony`, `withheld`). Tests:
`tests/unit/domain/made/run-phase.test.ts`, `phase.test.ts`.

### Task 3: Hechos y libro

`MadeFactFactory.ceremonyStarted/ceremonyEnded`; `MadeGrantLedger` lee ambos (tolerante), con
`ceremonies`, `running`, `liveOn` y `sessionsWithCeremonies`. Tests: `MadeGrantLedger.test.ts`.

### Task 4: `CallMadeTool` y `RevokeMadeGrants`

Orden en `execute`: never → `out_of_phase` → arranque sin id → token (tras la llamada confirmada de
un arranque, `made.ceremony_started`) → llamada → si deniega y la clase es confirm y la decisión es
una escritura de ejecución sobre una instancia propia viva, grant auto compartido y un reintento →
si no, S3a. Todo resultado con éxito pasa por la observación del terminal (`made.ceremony_ended` +
`RevokeMadeGrants.ceremonyEnded`, en la misma cadena que el cierre). Tests:
`tests/unit/application/use-cases/CallMadeToolRun.test.ts`.

### Task 5: Superficies

`SessionMadeDto.ceremonies`, `/underpass-status`, `underpass made ceremonies`, `/underpass-phase run`
con autocompletado. Tests: `made-status.test.ts`, `MadeCli.test.ts`.

### Task 6: Contrato con `made-mcp` 0.8.0 real

`tests/contract/made-run.contract.test.ts` sobre el host real: publicar `pi_runtime_run_smoke`
(dos pasos) y llevarla al terminal con una confirmación; otra sesión y otra fase no heredan nada;
grants revocados en el log y en MADE. Los helpers del contrato de S3a pasan a
`made-host-support.ts`.

### Task 7: Aceptación en la instalación real

`tests/acceptance/made-run-session.ts` con Pi real por el SDK (modelo `faux`), host, `made-mcp` y
`kmp-mcp` reales sobre estado temporal, desde el checkout principal en `--detach` en la rama; se
deja en `main`. Resultado en `docs/acceptance/f3.md`.

## Cobertura de la spec

| Spec | Tareas |
|---|---|
| §1 fase `run` y el mínimo medido | 1, 2, 6 |
| §2.1–2.2 una confirmación y `made.ceremony_started` | 3, 4, 6, 7 |
| §2.3–2.4 auto en instancia propia, confirm en las demás | 2, 4, 6 |
| §2.5 la fase manda, `out_of_phase` | 2, 4, 6 |
| §2.6 arranque sin id | 4, 6 |
| §3 terminal, `ceremony_ended`, cierre | 3, 4, 6, 7 |
| §4 compatibilidad del log | 2, 3 |
| §5 superficies | 5, 7 |

## Decisiones tomadas donde la spec deja margen

1. **Grants de instancia con clase `auto`** en `made.grant_issued`, no una clase nueva: las versiones
   anteriores los leen y los revocan igual. Qué grants son «de la instancia» se deduce del alcance.
2. **Al terminal se revocan todos los grants vigentes de la sesión con ese alcance**, también el de
   lectura (`get_ceremony_instance`): la instancia ya no admite escrituras y la siguiente lectura se
   concede sola, como cualquier lectura.
3. **Sólo un arranque confirmado cuenta.** Si un grant ajeno (otro cliente del mismo store) cubre el
   arranque y MADE no lo deniega, no hay confirmación y la instancia no es «propia».
4. **El terminal se detecta en los resultados**, no se sondea: una instancia que termina por fuera
   mantiene sus grants hasta que la sesión la lea o se cierre.
5. **`out_of_phase` sólo para las escrituras de ejecución**, para no cambiar el comportamiento de S3a
   en el resto de tools.
