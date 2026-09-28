# P0 — Hallazgos de contrato (2026-09-28)

| Servidor | Versión | protocolVersion | Tools | Huella |
|---|---|---|---|---|
| kmp-mcp | 0.24.0 | 2024-11-05 | 16 | `0c8ba8a73e456541e27d03b922b0a8d88d525360fbeadf42aa6b65388f1654a3` |
| made-mcp | 0.8.0 | 2024-11-05 | 104 | `21f60e5de3214bd303fff99617f19b1d9f493e9202215444c390d8081d979851` |

- Grupos de MADE: `self_description`, `council_deliberation`, `council_configuration`, `council_journal`, `ceremony_design`, `agentic_system_design`, `ceremony_execution`, `ceremony_recovery`, `ceremony_agent_visibility`, `human_authorization`, `ceremony_participation`, `integrator_loop`, `authorization_administration`, `service_observability`, `ceremony_history`, `ceremony_reporting`, `ceremony_budgets`, `artifact_transfer`.
  Límites declarados: `successor_budget_transfer_is_refused`, `agentic_system_has_no_authorization_scope`, `agent_roster_is_process_local`, `host_activation_is_not_reported_over_grpc`, `stall_detection_is_bounded_by_the_ledger_window`.
- Cabeza de cola: `made_get_status` respondió a los **2011 ms** detrás de una espera de 2000 ms en `made_await_integrator_attention`.
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
2. Emite una concesión de autorización (`made_issue_authorization_grant`) a ese principal
   para `get_status`, `bind_ceremony_integrator` y `await_integrator_attention`, con alcance
   `global`.
3. Vincula un integrador de prueba (`made_bind_ceremony_integrator`) sobre un
   `system_execution` inventado.
4. Lanza en paralelo, sobre la misma conexión stdio, una espera de 2000 ms en
   `made_await_integrator_attention` y una llamada a `made_get_status`, y mide cuánto tarda
   la segunda.

El resultado — la segunda llamada resuelve ~2000 ms después, no de inmediato — confirma lo
que dice `global-constraints.md`: **cada conexión stdio procesa en secuencia**, así que una
espera larga en una llamada bloquea a las que vienen detrás en la misma conexión. De ahí la
regla para S3: nunca una espera larga en la conexión propietaria/planificador.
