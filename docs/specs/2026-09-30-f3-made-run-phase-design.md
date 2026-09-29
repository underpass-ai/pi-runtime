# F3 — Fase `run`: arrancar una ceremonia publicada y llevarla a su terminal

- **Fecha:** 2026-09-30
- **Estado:** autorización decidida por Tirso (se confirma sólo el arranque); el resto, esta spec.
- **Contexto:** `docs/specs/2026-09-30-s3a-made-authorization-design.md` (S3a). F3 extiende ese
  modelo; todo lo que aquí no se dice sigue como en S3a.

## 0. Problema

Tras diseñar y publicar una ceremonia desde Pi (fase `design`), no se puede ejecutar desde la misma
sesión: `Phase` sólo tiene `interactive` y `design`, `design` sólo expone las tools de diseño, y
`made_start_published_ceremony` está en el perfil `MADE_SESSION` pero ninguna fase lo selecciona.

## 1. La fase `run`

`/underpass-phase run` (con autocompletado) expone lo de `design` más el mínimo para arrancar una
ceremonia publicada y llevarla a un terminal con pasos `host_callback` hechos por el propio agente
de Pi. El mínimo se determinó contra `made-mcp` 0.8.0 real (store temporal), no se supuso:

| Tool | Clase S3a | Por qué |
|---|---|---|
| `made_start_published_ceremony` | confirm | Arrancar la publicada. MADE decide su autorización con alcance `ceremony {ceremony_id}`; **sin `ceremony_id` la decide con alcance `global`**, que S3a nunca concede y que, concedido, MADE rechaza igual (`authorized operation scope does not admit this ceremony`). |
| `made_claim_ceremony_step` | confirm → auto en instancia propia | Reclamar el paso `host_callback`; devuelve el `claim_fence`. Acepta `lease_ttl_ms`, así que la renovación no hace falta para llegar al terminal. |
| `made_complete_ceremony_step` | confirm → auto en instancia propia | Registrar el resultado con el `claim_fence`. En 0.8.0 no pide grant propio (le basta la reclamación); se incluye en la tabla por si otra versión lo exige. |
| `made_apply_ceremony_transition` | confirm → auto en instancia propia | Completar un paso no mueve la instancia: la transición habilitada se aplica aparte, hasta el estado terminal. |
| `made_get_ceremony_instance` | auto | Releer el estado (pasos reclamables, transiciones habilitadas). Cada escritura ya devuelve la instancia; se incluye para retomar tras perder el hilo. |

Fuera del mínimo (medidas y descartadas): `renew_ceremony_step_lease` (con `lease_ttl_ms` en la
reclamación no hace falta; además, en 0.8.0 exige que la autorización de la reclamación siga viva),
`bind_ceremony_participants` (reclamar no exige participantes sentados), `cancel_ceremony`,
`run_ceremony_step` (ejecuta el handler del servidor, no el del agente) y todas las `never` de S3a.

El recorrido medido para una definición lineal de N pasos: `start` → (`claim` → `complete` →
`apply_transition`) × N → `lifecycle: ended`, `end_reason: completed`.

## 2. Autorización

1. **Se confirma sólo el arranque.** `made_start_published_ceremony` sigue siendo `confirm`: la
   TUI pregunta (`MADE: start_published_ceremony` / `Ceremony "<id>"`), con el grant de 5 min
   consumido de S3a.
2. **Hecho `made.ceremony_started`** (stream de la sesión, `type_version` 1,
   `{ceremonyId, definition, version}`): lo registra el host cuando el arranque **confirmado**
   vuelve con éxito y la instancia que devuelve MADE es la del alcance confirmado. Sólo identidad:
   ni contexto ni salidas. Un arranque que MADE rechaza, o que no pasó por la confirmación, no
   registra nada.
3. **Escrituras de ejecución sobre esa instancia: auto.** Cuando MADE deniega `claim`, `complete`
   o `apply_ceremony_transition` y la decisión trae el alcance `ceremony {ceremony_id}` de una
   instancia que esta sesión arrancó y que no ha terminado, el host emite el grant sin preguntar,
   con ese alcance exacto (la forma de `MadeScope` que MADE acepta), y reintenta una vez, como un
   `auto` de S3a (clase `auto` en `made.grant_issued`, vigencia de 12 h como tope).
4. **Sobre cualquier otra instancia**, las mismas escrituras siguen siendo `confirm` como hoy,
   también si la arrancó otra sesión. Las lecturas, `auto` como hoy.
5. **La fase sigue mandando.** Fuera de `run` nada de esto se expone ni se concede. Además, las
   escrituras de ejecución que lleguen con contexto de una fase que no las expone (o sin fase) se
   rechazan en el host sin llegar a MADE (negativa `out_of_phase`), para que un grant de instancia
   vivo nunca se use fuera de `run`.
6. **Arranque sin `ceremony_id` en `run`:** el host lo rechaza antes de llamar a MADE con
   `invalid_arguments` y un mensaje que dice qué falta, en vez de la denegación global opaca.

## 3. Ciclo de vida

- **Terminal.** El host mira cada resultado de MADE de la sesión: si es una instancia que la sesión
  arrancó y trae `lifecycle: ended` (completada, cancelada o fallida), registra
  `made.ceremony_ended` (stream de la sesión, v1, `{ceremonyId, endReason}`, con `endReason` como
  identificador o `unknown`) y revoca los grants vigentes de la sesión con el alcance de esa
  instancia (`made.grant_revoked`, motivo nuevo `ceremony_ended`). Desde ahí, esa instancia deja de
  ser «propia»: otra escritura vuelve a preguntar.
- **Cierre de sesión, huérfanos y arranque del host:** como en S3a (`RevokeMadeGrants`), en la
  misma cadena de revocaciones.
- **Límite conocido:** si la instancia termina por fuera (otro cliente la cancela) y la sesión no
  vuelve a leerla, sus grants viven hasta el cierre de la sesión (12 h como máximo).

## 4. Compatibilidad del log

`made.ceremony_started` y `made.ceremony_ended` son tipos nuevos: una versión anterior los conserva
opacos (lectores tolerantes de S3a §4). Los grants de instancia se registran como `made.grant_issued`
con clase `auto`, un valor que las versiones anteriores ya leen, así que las revocan igual al cerrar
la sesión o como huérfanos. El motivo `ceremony_ended` es texto en `made.grant_revoked`, que el libro
de grants ya guarda tal cual. Los lectores nuevos ignoran payloads inesperados, fines de instancias
que la sesión no arrancó y un segundo arranque o fin de la misma instancia (manda el primero).

## 5. Superficies

- **`/underpass-status`:** tras la línea `made:`, una por instancia arrancada:
  `  ceremony <id> (<definición> v<versión>): running · grants claim_ceremony_step, …` o
  `ended (<motivo>) · no active grants`.
- **`underpass made ceremonies`:** cada instancia arrancada por cada sesión, con su estado, su
  arranque y sus grants (id, estado y motivo de revocación, acción).

## 6. Pruebas y aceptación

- **Dominio:** tabla de fases (`run` = `design` + el mínimo, nada `never`), clases en `run`,
  `executesInstance`, `withheld`, alcance de instancia, `CeremonyId`, `CeremonySnapshot`,
  `StartedCeremony`, tipos y motivos nuevos.
- **Aplicación:** una confirmación arranca y registra; reclamar, completar y la transición van
  solas; al terminal, `ceremony_ended` y revocación; otra instancia u otra sesión siguen en
  `confirm`; fuera de `run`, `out_of_phase` sin llegar a MADE; arranque sin id; cierre de sesión;
  lector tolerante.
- **Contrato con `made-mcp` 0.8.0 real** (`tests/contract/made-run.contract.test.ts`): diseñar y
  publicar `pi_runtime_run_smoke` (dos pasos), arrancarla en `run` con una sola confirmación y
  llevarla al terminal; grants de instancia revocados en el log y en MADE.
- **Aceptación en la instalación real:** `docs/acceptance/f3.md`.

## 7. Fuera de alcance

- Renovar reclamaciones, sentar participantes, cancelar, pausar o reanudar desde Pi.
- Leer el `prompt` de un paso de una publicada que no se diseñó en la sesión: ni la instancia, ni
  la reclamación, ni el transcript de 0.8.0 lo devuelven (ver decisiones abiertas en la PR).
- Guardas humanas (`approve_ceremony_guard`) y el bucle de integrador.
