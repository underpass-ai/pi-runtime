# P0 — Hallazgos de contrato (2026-09-28)

| Servidor | Versión | protocolVersion | Tools | Huella |
|---|---|---|---|---|
| kmp-mcp | 0.24.0 | 2024-11-05 | 16 | `0c8ba8a73e456541e27d03b922b0a8d88d525360fbeadf42aa6b65388f1654a3` |
| made-mcp | 0.8.0 | 2024-11-05 | 104 | `21f60e5de3214bd303fff99617f19b1d9f493e9202215444c390d8081d979851` |

- Grupos de MADE: `self_description`, `council_deliberation`, `council_configuration`, `council_journal`, `ceremony_design`, `agentic_system_design`, `ceremony_execution`, `ceremony_recovery`, `ceremony_agent_visibility`, `human_authorization`, `ceremony_participation`, `integrator_loop`, `authorization_administration`, `service_observability`, `ceremony_history`, `ceremony_reporting`, `ceremony_budgets`, `artifact_transfer`.
  Límites declarados: `successor_budget_transfer_is_refused`, `agentic_system_has_no_authorization_scope`, `agent_roster_is_process_local`, `host_activation_is_not_reported_over_grpc`, `stall_detection_is_bounded_by_the_ledger_window`.
- Cabeza de cola: `made_get_status` respondió a los **2012 ms** detrás de una espera de 2000 ms en `made_await_integrator_attention` (prueba con aserción `ms >= 1500`, no sólo el log).
  **Regla para S3:** `made_await_integrator_attention` con `wait_timeout_ms` ≤ 1000 en la conexión propietaria y planificador justo; nunca long-poll de 30 s.
- Sin `ping` ni `notifications/cancelled`: un timeout del cliente deja el resultado desconocido y lleva a reconciliación.

## Nota sobre el verbo de cabeza de cola

El brief de la Tarea 8 medía la cabeza de cola con `made_pull_ceremony_events` y un
`wait_timeout_ms` en sus argumentos. Contra el binario real, `made_pull_ceremony_events`
no tiene ese campo en su `inputSchema` (sólo `consumer`, `acknowledge_through`, `limit`) y
responde siempre al instante, sin bloquear nunca. Siguiendo la propia guía del brief — "lo
que se mide es el bloqueo en cabeza de cola, no ese verbo" — la prueba se rehízo con
`made_await_integrator_attention`, que sí trae `wait_timeout_ms` (por defecto 1000 ms, tope
30000 ms) y es la que cita la nota "Regla para S3" del propio hallazgo esperado.

Ese verbo exige una concesión de autorización propia y una vinculación de integrador antes
de poder esperar: un store recién arrancado con `bootstrap-authorization` no trae ninguna
concesión, y hasta `made_get_status` la exige. La prueba de cabeza de cola, antes de medir,
ahora:

1. Lee `made_get_authorization_policy` (sin necesitar concesión: el propietario ya puede
   leer su propia política) para obtener el `principal_id` del trusted host local.
2. Emite **dos** concesiones de autorización, cada una con el alcance más estrecho que
   `made_issue_authorization_grant` acepta para esas acciones (ver "Alcance de las
   concesiones" más abajo):
   - `bind_ceremony_integrator` y `await_integrator_attention`, alcance `ceremony` atado a
     un `ceremony_id` de prueba.
   - `get_status`, alcance `global` (probado sin alternativa: ver más abajo).
3. Vincula un integrador de prueba (`made_bind_ceremony_integrator`) sobre ese mismo
   `ceremony_id` (no un `system_execution`: ver más abajo).
4. Lanza en paralelo, sobre la misma conexión stdio, una espera de 2000 ms en
   `made_await_integrator_attention` y una llamada a `made_get_status`, y mide cuánto tarda
   la segunda. La prueba afirma `ms >= 1500` (no sólo lo registra) y afirma que la llamada
   rápida resolvió con éxito y no con una negativa — así una regresión a MADE concurrente,
   o una llamada rápida que en realidad fue una negativa disfrazada, ponen la prueba en
   rojo en vez de dejarla pasar en silencio.

El resultado — la segunda llamada resuelve ~2000 ms después, no de inmediato — confirma lo
que dice `global-constraints.md`: **cada conexión stdio procesa en secuencia**, así que una
espera larga en una llamada bloquea a las que vienen detrás en la misma conexión. De ahí la
regla para S3: nunca una espera larga en la conexión propietaria/planificador.

### Alcance de las concesiones (ronda de revisión 1/5)

El `inputSchema` de `made_issue_authorization_grant` sólo admite estos alcances:
`global`, `ceremony` (con `ceremony_id`), `ceremony_tree` (con `root_id`), `definition`
(con `name`/`version`), `artifact` (con `artifact_id`), `council` (con `council_id`) y
`budget` (con `account_id`). No existe un alcance para `system_execution` ni para una
vinculación de integrador como tal.

- `bind_ceremony_integrator` y `await_integrator_attention` **sí** aceptan el alcance
  estrecho `ceremony`: con una concesión atada a un único `ceremony_id` de prueba, ambas
  acciones pasan la comprobación de autorización (la vinculación tiene éxito; la espera
  entra en el bloqueo real en vez de fallar con "authorization decision … denied the
  operation"). Por eso la vinculación de prueba usa alcance `ceremony`, no
  `system_execution` como en la ronda anterior — `system_execution` sólo era necesario
  porque no hacía falta narrow scope todavía.
- `get_status` **no** tiene alcance más estrecho posible: probado con sólo una concesión
  `ceremony`-scoped en vigor (sin ninguna `global`), la llamada devuelve
  `ToolRefusal: authorization decision … denied the operation`. Es una acción de servicio
  sin recurso al que atarse, así que sigue necesitando `global`.
- Efecto colateral observado: como el `ceremony_id` de prueba nunca se arrancó con
  `made_start_ceremony`, `made_await_integrator_attention` termina devolviendo
  `ToolRefusal: not found: ceremony_instance` — pero sólo **después** de agotar los 2000 ms
  de `wait_timeout_ms`, no de inmediato. Eso es justo lo que hace falta para medir el
  bloqueo en cabeza de cola: la autorización se resuelve (no hay "denied"), y el servidor
  sigue reteniendo la conexión el tiempo completo antes de comprobar que el recurso no
  existe.
