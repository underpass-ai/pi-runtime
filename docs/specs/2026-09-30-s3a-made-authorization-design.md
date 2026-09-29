# S3a — Autorización de MADE gestionada por el host

- **Fecha:** 2026-09-30
- **Estado:** aprobada por Tirso.
- **Contexto:**
  - `docs/specs/2026-09-28-pi-runtime-design.md` (S3: sesión, grants por worker).
  - `docs/specs/2026-09-29-e1-event-log-design.md` (log de eventos).
  - L1 §12, sobre la compatibilidad de los tipos de hecho.

## 0. Problema y decisiones

En S1, el host lanza `made-mcp` en modo embebido. MADE trata todas sus llamadas con un único principal, el trusted host `MADE_AUTH_TRUSTED_HOST_ID`. Ese principal es dueño de la política, pero por sí mismo solo puede emitir, revocar y leer grants y decisiones. Como pi-runtime nunca emite grants, todas las tools de negocio de MADE se deniegan para cualquier usuario de Pi, incluidas las de solo lectura. Lo vimos el 2026-09-29: cinco decisiones de denegación seguidas al diseñar `pr_review_two_reviewers`.

Decisiones:

1. **El host es el punto de control.** Cuando MADE deniega una llamada, el host lee la decisión, que le da la acción y el alcance exactos. Si la política de fase lo permite, se emite un grant exacto y reintenta una sola vez. Así Pi no duplica la lógica de alcances de MADE.
2. **Las acciones de lectura y borrador son automáticas:** grant exacto hasta el cierre de la sesión.
3. **Las acciones que escriben requieren confirmación humana en la TUI de Pi.** El host emite un grant exacto de 5 minutos, ejecuta la llamada confirmada y revoca el grant en cuanto vuelve (motivo `consumed`, ruling R5): el grant cubre sólo esa llamada, no otras con la misma acción y alcance (de otra sesión o del plugin de Claude, que en el mismo store actúan como el mismo principal). Sin UI, se deniega. No se usa `made_approve_authorization_operation`: en modo embebido quien aprueba no puede ser distinto de quien ejecuta, así que es estructuralmente imposible.
4. **Excepción temporal para las acciones que MADE 0.8.0 solo autoriza con alcance `global`:** `design_ceremony`, `list_contracts` y `diff_ceremony_definitions`. Se conceden con alcance global, limitadas a esa acción y a la sesión, y se abren issues en MADE para poder acotarlas por definición. La lista es cerrada (`MadeActionPolicy`): cualquier otra acción cuya decisión tenga alcance `global` no se concede nunca y devuelve la denegación original.
5. **Auditoría en el log de E1** con hechos nuevos. Antes de añadirlos, los lectores del log deben tolerar tipos desconocidos.

## 1. Clasificación de acciones

`MadeActionPolicy` (dominio) clasifica cada acción de MADE, con el nombre de la tool sin el prefijo `made_`, en una de tres clases:

- **`auto`: lectura o borrador.** Se concede sola si la fase actual expone la tool.
  - Lecturas: `get_status`, `discover_capabilities`, `get_help`, `list_contracts`, `list_ceremony_instances`, `get_ceremony_instance`, `get_ceremony_transcript`, `read_ceremony_events`, `get_artifact`, `list_artifacts`, `read_artifact_chunk`, `get_budget_report`, `get_metrics`, `explain_ceremony_draft`, `validate_ceremony_draft`, `diff_ceremony_definitions`.
  - Borrador: `design_ceremony`.
  - El resto de acciones de lectura que ya estén en la lista de fases de S1.
- **`confirm`: escribe o ejecuta.** Se concede solo con confirmación humana.
  - Publicar: `publish_ceremony_definition`.
  - Arrancar, avanzar y cerrar ceremonias: `start_*`, `run_*`, `claim_*`, `complete_*`, `apply_ceremony_transition`, `cancel_ceremony`, `pause_ceremony`, `resume_ceremony`.
  - Intervenciones, contratos, artefactos (`register_*`, `commit_*`, `tombstone_artifact`…).
  - Cualquier otra acción que no esté en `auto` ni en `never`.
- **`never`: nunca se conceden desde Pi.**
  - Administración de la autorización: `issue_authorization_grant`, `revoke_authorization_grant`, `approve_authorization_operation`, `get_authorization_policy`, `list_authorization_decisions`. Las usa solo el host, como dueño (`MadeOwner`), y nunca las expone al modelo:
    - no aparecen en el catálogo de MADE que el host sirve a Pi (ni en las candidatas de L1);
    - una llamada por el socket a cualquiera de ellas se rechaza antes de llegar a MADE (negativa `refused`), traiga o no contexto de sesión. Pi puede reactivar tools de extensión por su cuenta; la negativa del host no depende de eso.

Reglas de clasificación:

- La tabla está cerrada: una acción desconocida es `confirm`.
- La fase manda. Una acción `auto` solo se concede si la fase actual expone esa tool (`PhaseToolSelection`).

## 2. Flujo en el host

`ServeHostRequest.call` para el servidor `made`:

1. Llama a la tool.
2. Si el resultado es una denegación de autorización (negativa con el código `refused` de MADE y el mensaje exacto `authorization decision <id> denied the operation`; el mensaje con otro código pasa tal cual), el host:
   1. Lee la decisión con `list_authorization_decisions`, como dueño, para obtener la acción y el alcance exactos. Si no la encuentra, devuelve el error original.
   2. Si la decisión tiene alcance `global` y la acción no está en la excepción del §0.4, devuelve la denegación original.
   3. **Clase `auto` permitida por la fase:** emite un grant con estos parámetros y reintenta la llamada exactamente una vez.
      - `grantee` = `issuer` = trusted host.
      - La acción y el alcance exactos de la decisión.
      - Vigencia desde ahora hasta el mínimo entre el cierre de la sesión y 12 h. Como no conocemos el cierre, se usa 12 h y se revoca al cerrar (§4).
      - `delegation_depth` 0, sin padre.
   4. **Clase `confirm`:** si no hay token, devuelve un rechazo estructurado `needs_confirmation {action, scopeSummary}`. `scopeSummary` es legible: tipo de alcance y nombre o versión de la definición o id de ceremonia, nunca contenido. Si la petición trae un token de confirmación válido para esta llamada (§3), el host no llama primero: emite un grant con la acción y el alcance aceptados, válido 5 minutos, hace la llamada y revoca el grant en cuanto vuelve, con éxito, negativa o error (`made.grant_revoked`, motivo `consumed`). Al redimir el token vuelve a mirar la fase: si ya no expone la tool, la llamada sigue sin grant y vuelve la denegación original.
   5. **Clase `never`, o una acción que la fase no permite:** devuelve la denegación original. (Las `never` ni siquiera llegan a MADE: §1.)
3. **Sin caché.** El host sólo emite tras una denegación de MADE, y una denegación significa que ningún grant vigente cubre esa acción y alcance, tampoco uno que el host emitiera antes y alguien revocara por fuera: nunca se reutiliza, se emite otro. Dos denegaciones simultáneas de la misma sesión, acción y alcance comparten una sola emisión. Los grants `confirm` nunca se reutilizan: cada confirmación emite el suyo y lo consume.
4. **Ids:** el id de grant es determinista, derivado de la sesión, la acción, el alcance y el instante, para que el reintento sea idempotente (MADE trata como no-op un grant idéntico con el mismo id).
5. **Fallos:** si la emisión falla, se devuelve la denegación original. Nunca hay bucles: un único reintento por llamada.

## 3. Confirmación en la extensión

- Cuando una llamada a una tool de MADE devuelve `needs_confirmation`, `PiToolFactory`:
  1. Pregunta al usuario con `ctx.ui.confirm` (o el equivalente de Pi 0.87.1): «MADE: publicar la definición pr_review_two_reviewers v1.0. ¿Permitir?».
  2. Si acepta, repite la llamada con un token de confirmación.
  3. Si rechaza, devuelve el error al modelo como una negativa (`refused`, código `needs_confirmation_declined`).
- **Token:** lo genera el host y viaja en la respuesta `needs_confirmation`. Es de un solo uso, vale 2 minutos y está ligado a la llamada exacta (sesión, tool y digest de los argumentos). La extensión solo lo reenvía y no lo inventa.
- **Sin UI** (`hasUI` es false, por ejemplo con `pi -p`): no se pregunta. Se devuelve una negativa con el código `needs_confirmation_no_ui`.
- Cada confirmación y cada rechazo se registra como hecho (§4).
- **Abortar el diálogo no es un rechazo.** Si el usuario cierra o cancela el diálogo de confirmación sin elegir «permitir» ni «rechazar» (por ejemplo, `Ctrl-C` o cerrar la TUI), no se registra ningún hecho — ni `accepted` ni `declined` — y el modelo recibe `<tool> aborted; outcome unknown`, distinto del rechazo explícito.

## 4. Ciclo de vida y auditoría

Hechos nuevos, todos con `type_version` 1:

- **`made.grant_issued`** (stream de la sesión): `{grantId, action, scope, validUntil, class: auto|confirm}`.
  - `scope` es la forma de MADE: tipo y nombre, versión o id; nunca contenido.
- **`made.grant_revoked`** (siempre en el stream del host, nunca en el de la sesión: una sesión cerrada no acepta hechos nuevos en su propio stream): `{grantId, session, reason: session_closed|expired_cleanup|consumed}`. `consumed` es el grant de 5 minutos de una confirmación, revocado al volver su llamada (§2.2.4).
- **`made.confirmation`** (stream de la sesión): `{action, scopeSummary, outcome: accepted|declined|no_ui}`.

Reglas del ciclo de vida:

- **Cierre de sesión:** el host revoca los grants emitidos para esa sesión que sigan vigentes, y registra `made.grant_revoked` en el stream del host con `reason: session_closed`.
- **Arranque del host:** revoca los grants que registró en el log, que no están revocados y cuya sesión ya está cerrada. Cuentan como huérfanos (`reason: session_closed`) los grants emitidos antes del `session.closed` de su sesión, incluso si esa sesión se reabrió más tarde: la orfandad se decide por el hecho `session.closed` visto en el log, no por el estado actual de la sesión.
- **Si el host muere:** los grants caducan solos, en 12 h como máximo.
- **Prerrequisito:** los lectores del log (el almacén SQLite, el de memoria, `ImportEventLog`) toleran tipos de hecho desconocidos.
  - Un tipo desconocido se conserva como registro opaco: la cadena de hashes se verifica igual y las proyecciones lo ignoran.
  - Esto cierra el pendiente de L1 §12 y permite que versiones futuras añadan tipos sin romper a las anteriores.

## 5. Superficies

- **`doctor`, sección `[made-auth]`:**
  - `OK`: el host puede autorizarse. Lo comprueba con una operación de solo lectura de la política; no emite nada.
  - `WARN`: grants del host vigentes cuya sesión ya cerró (huérfanos), con el remedio `underpass made revoke-orphans`.
  - `WARN` informativo: el store de MADE es compartido con otra instalación, por ejemplo el plugin de Claude Code. Se detecta cuando hay más de una política en el store.
- **`underpass made grants`:** lista los grants emitidos por el host (id, sesión, acción, alcance, clase, caducidad y estado).
- **`underpass made revoke-orphans`:** revoca los huérfanos y registra los hechos.
- **`/underpass-status`:** añade la línea `made: <n> grants activos · <m> confirmaciones`.

## 6. Aguas arriba (MADE)

Issues en `underpass-ai/made`:

1. Alcance por definición o por contrato para `design_ceremony`, `list_contracts` y `diff_ceremony_definitions`, para retirar la excepción global del §0.4.
2. `made_get_help` (y el descubrimiento) responden antes de la puerta de autorización: verificado en 0.8.0, no está documentado en el catálogo. Pedimos que quede documentado qué tools se sirven sin autorizar.
3. A futuro: un principal humano distinto en modo embebido, para poder usar el flujo nativo de aprobación.

## 7. Pruebas y aceptación

- **Unitarias:**
  - `MadeActionPolicy` (las tres clases, fase y acciones desconocidas);
  - emisión sin caché (compartida entre denegaciones simultáneas) e ids deterministas; grant `confirm` consumido tras su llamada;
  - un único reintento;
  - token de confirmación de un solo uso, con caducidad y ligado a los argumentos;
  - hechos nuevos;
  - lectores tolerantes, donde un tipo desconocido conserva la cadena.
- **Integración con `made-mcp` real** (0.8.0, sobre un store y una configuración temporales, igual que en la aceptación de L1):
  - una lectura denegada se concede sola y funciona;
  - publicar sin token devuelve `needs_confirmation`, y con token publica;
  - la revocación al cierre;
  - los huérfanos al arrancar.
- **Extensión:** confirmación aceptada, rechazada y sin UI. Nunca se pregunta dos veces por la misma llamada.
- **Aceptación en la instalación real,** en un proyecto aislado con un store de MADE temporal:
  - el prompt de diseño de `pr_review_two_reviewers` diseña, valida y explica sin fricción;
  - publicar pide confirmación y, al aceptarla, publica;
  - `doctor` en verde;
  - los grants quedan revocados al cerrar la sesión.

## 8. Fuera de alcance

- `working_session` y grants por worker: el resto de S3.
- Segunda identidad en MADE.
- Aislamiento de workers con Underpass Runtime.
