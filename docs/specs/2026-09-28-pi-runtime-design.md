# Pi Runtime — Pi como runtime de Underpass, con MADE y KMP nativos

**Fecha:** 28 de septiembre de 2026
**Estado:** diseño aprobado por secciones; pendiente de revisión de la spec escrita. No hay implementación.
**Sustituye a:** `made-kmp-pi-integration-design.md` (RFC del mismo día), cuyas garantías defensivas se conservan y cuyas reimplementaciones se retiran.

> Nota: el proyecto se llamó `underpass-pi` hasta el 29 de septiembre de 2026; hoy es `pi-runtime` (repo `underpass-ai/pi-runtime`), también en las rutas de estado e instalación.

## 0. Tesis

Pi es el runtime agéntico de Underpass. MADE y KMP no son integraciones opcionales, sino capacidades nativas de cualquier sesión:

- **MADE gobierna todo lo que es decisión:** procedimientos, claims, leases, presupuesto, permisos por worker, maker/checker, deliberación con contrato y validación de evidencia, razones causales, sucesión y handoff.
- **Pi ejecuta todo lo que razona:** pasos con efectos y también las propuestas, críticas y juicios de los councils de MADE.
- **KMP recuerda con evidencia:** memoria siempre activa y acotada, proyección canónica del diario de MADE, dimensiones de MADE como etiquetas y curación gobernada.
- **El host Pi Runtime cose:** es un integrador determinista, sin FSM propia, sin presupuesto propio, sin autorización propia y sin validador propio.

### Qué cambia respecto al RFC anterior

| RFC anterior | Este diseño | Motivo |
|---|---|---|
| Presupuesto contabilizado en el host | Reserva por claim en MADE (`budget_reservation`), conciliada con el execution receipt; el uso real se reporta con `report_ceremony_agent_status` | MADE ya lo hace y cierra la admisión al excederse |
| Gateway propio como autoridad de permisos | Grant efímero de MADE por worker (principal `Worker`, scope `Ceremony`/`CeremonyTree`) + maker/checker de MADE; el aislamiento local sigue siendo necesario, pero ya no decide negocio | La auditoría queda en el diario y un fallo del host no permite la autoaprobación |
| Validación del resultado en el host | Council con `output_contract` + `claims_evidence_grounded`/`supported` | Se exige que cada afirmación cite refs del contexto |
| Revisión independiente "por disciplina" | `independence_group`, `rounds: 0`, `aggregate: vote`, quórum de hijas | MADE rechaza al revisor que comparte grupo con el revisado |
| Proyección con `kmp_write_memory` y gestión de `needs_review` | `kmp_ingest` canónico con `provenance` | La traducción es mecánica y no se atasca por revisión semántica |
| Un about por cambio y fase | Abouts duraderos + etiquetas MADE (`ceremony`, `definition`, `step`, `role`, `council`, `outcome`, `run`) | Selectores en lugar de contenedores efímeros |
| Enriquecimiento de relaciones sin gobierno | Ceremonia `memory_curation` (curador Pi + revisor Pi) sobre `kmp_curate`, `kmp_relabel` y `kmp_summaries_audit` | La memoria también queda auditada y con presupuesto |
| KMP bajo petición | Siempre activo con wake enfocado y presupuesto acotado | Runtime propio: la memoria forma parte de él |
| MADE sólo para ceremonias explícitas | Toda sesión abre una `working_session` y los procedimientos se promueven como ceremonias hijas | Presupuesto, roster, intervenciones y handoff en todo el trabajo |
| Fork de Pi sin equivalente en MADE | `plan_ceremony_successor` / `start_ceremony_successor`, `inspect_ceremony_resume`, `record_ceremony_host_handoff` | Verbos existentes en MADE 0.8.0 |
| Journal técnico propio para la recuperación | Execution receipts de MADE (intención sellada, `complete`, `adopt`, `inspect_execution_recovery`) | Una sola fuente de verdad para la reconciliación |

Se conservan del RFC anterior, sin cambios de fondo: fences y su separación de la idempotencia externa; `agent_settled` frente a `agent_end`; leases renovadas por el host; deduplicación de atención por `delivery_id` con acuse `intent`/`processed`; preservación de `UNKNOWN`, conflictos y cursores; que la compaction no es memoria; que el fork de Pi no deshace MADE ni KMP; que la memoria recuperada es contenido no confiable; la separación entre sobre privado y contexto visible; y la prueba crítica de long-poll frente a renovación en la misma conexión.

## 1. Base verificada

| Componente | Revisión | Notas |
|---|---|---|
| MADE | v0.8.0 (`origin/main` `8460db14`) | 104 tools. **El plugin instalado localmente es 0.7.0**: faltan integrador, sistemas agénticos, roster, intervenciones dirigidas, sucesión, handoff y `renew_ceremony_step_lease`. Actualizar con `/made:setup` antes de P0. |
| KMP | v0.24.0 (`main` `fe779658`) | 16 tools (+4 de app con MCP Apps). Jev opcional por store. |
| Pi | `@earendil-works/pi-coding-agent` 0.87.1 (revisión `1189401`) | SDK y extensiones; sin MCP nativo. Validar el paquete publicado en P0. |

MADE y KMP no tienen binding para TypeScript. Ambos se consumen por **stdio MCP persistente** (`made-mcp`, `kmp-mcp` embebidos con SQLite). El gRPC de ambos queda como camino futuro para la composición remota.

## 2. Descomposición en subproyectos

Cada uno tendrá su propio plan de implementación.

| # | Subproyecto | Entrega | Depende de |
|---|---|---|---|
| S1 | **Distribución Pi Runtime** | Paquete con extensiones y binarios fijados; `underpass setup|doctor|update`; `Host::Pi` en KMP; bootstrap de autorización de MADE; catálogo de tools por fase; handshake de capacidades. | — |
| S2 | **KMP nativo en Pi** | Memoria siempre activa y acotada; guide con `purpose`; wake enfocado; condense; comandos `/catchup /save /restore /revert`; ChronoLoom. | S1 |
| S3 | **MADE nativo en Pi** | `working_session`, promoción a ceremonias hijas, integrador determinista, grants por worker, presupuesto, intervenciones y aprobaciones en la TUI, sucesión y handoff; `/ceremony /approve /budget`. | S1 |
| S5 | **Puente MADE→KMP** | Proyector `kmp_ingest`, mapeo de razones a relaciones, etiquetas, ceremonia `memory_curation`. | S2, S3 |
| S4 | **Pi como agente de MADE** | Adaptador delegado en MADE (`agent_kind: pi`), `agent_task_requested` / `made_submit_agent_output`; councils sobre Pi. Es el único cambio de dominio en MADE. | S3 |
| S6 | **Migración de productos** | AEO (`aeo_observatory_run`), Foundry y Signal Studio sobre el runtime. | S2–S5 |

**Orden:** S1 → S2 → S3 → S5 → S4 → S6. S2 y S3 aportan valor por separado. S4 es el más caro y sólo compensa cuando S3 funciona; hasta entonces, las revisiones usan sistemas agénticos con `independence_group` y `aggregate: vote` sobre pasos ejecutados por Pi.

## 3. Arquitectura y autoridad

```text
Usuario ──► Pi (TUI) + extensiones pi-underpass-host / pi-kmp / pi-made
                │  IPC local tipado (socket 0600, sin API de administración)
                ▼
        Host Pi Runtime — determinista, TrustedHost ante MADE
          ├─ cliente MCP stdio persistente ──► made-mcp ──► MADE (SQLite, diario, artefactos)
          ├─ cliente MCP stdio persistente ──► kmp-mcp  ──► KMP (SQLite, ChronoLoom, Jev opcional)
          ├─ workers Pi SDK (autor, revisor, curador, tareas de council) — aislados
          ├─ spool de proyección MADE→KMP (cursor + recibos)
          └─ registro técnico: PIDs, incarnations, worktrees, recibos de transporte
```

| Dato o decisión | Autoridad |
|---|---|
| Definiciones, estado, claims, leases, presupuesto, grants, aprobaciones, resultados aceptados, razones, receipts | MADE |
| Conversación, árbol de sesión, compaction | Pi |
| Memoria duradera, relaciones, vigencia, procedencia, etiquetas | KMP |
| Procesos, worktrees, spool y cursores de proyección | Host |

El host no guarda una FSM paralela, no interpreta YAML para ejecutar, no puntúa resultados y no decide permisos de negocio.

**Transporte.** Una conexión persistente por servicio y por host. El roster de MADE es local a su proceso (`agent_roster_is_process_local`), de modo que actividad, intervenciones y renovaciones pasan todas por la conexión propietaria. Si `made-mcp` serializa las llamadas, `await_integrator_attention` usa esperas cortas y un planificador justo. Esto se mide en P0.

**Servicio por proyecto.** Se resuelve por identidad de proyecto (raíz git normalizada), con un lock de propietario y un handshake. Dos ventanas de Pi sobre el mismo proyecto comparten el host y no lo duplican.

## 4. Ciclo de vida de una sesión

### 4.1. Apertura

1. **Identidad:** raíz git, store de KMP (resolución estándar: `KMP_MCP_DATA_DIR` → config → `.kernel/` del repo → store por defecto) y store de MADE fuera del workspace.
2. **MADE:**
   - `made_discover_capabilities`: se validan los grupos requeridos y `declared_limits`. Si falta un grupo, el perfil afectado no arranca.
   - `made_start_published_ceremony(working_session)` con `budget_limits` del perfil de usuario/proyecto.
   - `made_bind_ceremony_integrator{scope: ceremony, host_kind: "pi", incarnation}`; se guarda el fence.
   - Grant `Worker` para el worker interactivo (scope `Ceremony`, acciones de su rol).
3. **KMP:**
   - Routing `always`, dentro del runtime.
   - `kmp_guide{registration_key: <sesión>, purpose: continue}`; se conservan `agent_id` y `context_id`.
   - `kmp_wake{about, intent, budget.max_bytes ≈ 2048}` (wake enfocado si hay Jev). Se sigue `projection.next_action` hasta el presupuesto; si se corta, el paquete se declara parcial.
   - El paquete entra en `before_agent_start` como evidencia delimitada (con ref, reloj y completitud), nunca como instrucción.

Sin about conocido, no hay wake: sólo guide. La sesión puede declarar el about más tarde.

### 4.2. Durante el trabajo

- **Catálogo por fase** con `setActiveTools()`, siempre comprobado contra el registro:
  - interactivo: `kmp_ask`, `kmp_time`, `kmp_trace`, `kmp_inspect`, `kmp_relate`, más `kmp_write_memory` / `kmp_relabel` para decisiones explícitas del usuario;
  - los verbos de control de MADE los llama siempre el host; las tools de autoría (`made_design_ceremony`, `validate`, `explain`, `diff`) sólo en la fase de diseño.
- **Refresco de memoria:** el wake se renueva sólo al cambiar de about, de fase o de selector de etiquetas, o por petición. Los caminos que se releen usan tarjetas `kmp_condense` (`search.compact`). Las preguntas fechadas usan `kmp_ask` con `as_of`/`interval` y el eje que corresponda.
- **Promoción:** cuando la intención encaja con una ceremonia publicada (PR, release, revisión, incidente, AEO…), el host lo propone. Si el usuario acepta, la ceremonia se abre como hija de la sesión, hereda la cuenta de presupuesto y los grants se delegan con scope `CeremonyTree`. Nunca se promueve sin confirmación.
- **Actividad:** `report_ceremony_agent_status` con `requested/actual_model`, `reasoning_effort`, `usage` y `liveness`. El presupuesto que muestra `/budget` sale de `made_get_budget_report`.
- **Intervenciones:** `pull_ceremony_agent_interventions` en la conexión propietaria. Se inyectan con `steer()` o `followUp()` según la política. `queued` no es `received`; el acuse semántico lo hace una tool de acuse del agente.
- **Aprobaciones humanas:** diálogo en la TUI con objeto exacto, digest, evidencia e impacto. `made_approve_authorization_operation` se firma como principal humano. Una aprobación emitida por un modelo se rechaza.

### 4.3. Compaction, fork, reapertura y cierre

| Evento | Acción |
|---|---|
| Compaction | KMP: `agent_id` + nuevo `context_key`. Se preservan refs y restricciones activas. No se escribe memoria. |
| Fork / rewind de Pi | `plan_ceremony_successor` → `start_ceremony_successor`. La rama nueva no hereda claims ni presupuesto (MADE rechaza la transferencia). |
| Reapertura | `inspect_ceremony_resume`; el estado se consulta a MADE, nunca a `appendEntry`. |
| Cambio de proceso o máquina | `record_ceremony_host_handoff` con una incarnation nueva; reconciliación antes de cualquier efecto. |
| Cierre | Cierre cooperativo: se detiene la admisión, se vacía el spool de proyección, se lanza `memory_curation` si la definición lo pide y se ejecuta `kmp-mcp export` si el proyecto mantiene `.kmp/memory.jsonl`. Nunca se anuncia "sigue ejecutándose" sin un supervisor vivo. |

## 5. Paso con efectos

1. **Admisión:** `claimable_step_ids`, capacidad (`max_parallel`) y deadlines.
2. **Claim:** `made_claim_ceremony_step` con `budget_reservation{tokens, tool_calls, duration_micros, cost_micros; quality: estimated}`. Se persisten el recibo y el `claim_fence` antes de cualquier efecto. `quality: unknown` en una dimensión limitada se rechaza, y se respeta.
3. **Grant:** `made_issue_authorization_grant` al principal `Worker` de esta ejecución, con las acciones del rol, scope `Ceremony` y `valid_until` igual a la lease, delegado desde el TrustedHost. Se revoca al terminar.
4. **Intención:** se sella la intención del execution receipt (`operation_id` = ceremonia + paso + visita + iteraciones) con los bytes exactos.
5. **Contexto:**
   - `kmp_guide{purpose: continue}` con un `context_id` propio del worker;
   - `kmp_wake{intent}` con los selectores `definition`, `step` y `outcome`, que traen lo ocurrido en visitas anteriores de este paso;
   - paquete congelado para toda la unidad de trabajo.
6. **Ejecución:**
   - `createAgentSession()` en un worktree propio, con aislamiento real y un `ResourceLoader` controlado;
   - perfil de rol tomado del `RequestedExecutionProfile` de MADE;
   - la tool `underpass_submit_step_result` (propuesta) entrega un candidato y no completa nada.
7. **Seguimiento:** `made_renew_ceremony_step_lease` con un `renewal_id` nuevo por latido (idéntico en los reintentos), con margen respecto a la expiración efectiva; `report_ceremony_agent_status`.
8. **Cierre:**
   - tras `agent_settled`, se valida la forma del candidato;
   - los artefactos se suben por el protocolo de MADE (digest);
   - `made_complete_execution_receipt`;
   - `made_complete_ceremony_step` con el fence original;
   - `made_assert_ceremony_reason` por cada razón estructurada que declaró el worker (`chosen_because`, `satisfies_constraint`, `supersedes`…).
9. **Recuperación:** `inspect_execution_recovery` → `adopt_execution_receipt` o reconciliación. Nunca se reintenta a ciegas un efecto de resultado desconocido.

## 6. Revisión y decisión: councils sobre Pi (S4)

### 6.1. Cambio en MADE: adaptador de agente delegado (propuesto)

- Nuevo `agent_kind: pi` en el puerto de agentes del council. En lugar de llamar a un proveedor, emite el item de atención **`agent_task_requested`** con:
  - `task_id`, `deliberation_id` y fase (`propose|critique|judge`);
  - especialidad y rúbrica;
  - `ExternalContextBundle`;
  - `output_contract`;
  - deadline y `budget_reservation`.
- Nuevo verbo **`made_submit_agent_output{task_id, fence, idempotency_key, output, usage}`**, con su acción de autorización.
- MADE sigue puntuando, validando, ordenando y publicando `made.deliberation.completed`. Una tarea que vence se trata como un agente fallido, conforme a la semántica actual de deliberación.
- Paridad API↔MCP↔gRPC según el gate de paridad de MADE.

### 6.2. Uso

- **Paso de revisión:** handler deliberante con `agent_kind: pi`, `output_contract` y `evidence{claims_field, refs_field, allowed_refs_from_context}`; opcionalmente `semantic_support{min_confidence}`.
- **Bundle:** el host construye el `ExternalContextBundle` con refs exactas de KMP (`kmp_ask` / `kmp_trace` / `kmp_inspect` con `purpose: audit`) y los digests de los artefactos del autor. `claims_evidence_grounded` obliga a que cada afirmación cite una de esas refs.
- **Worker de tarea:** sesión Pi nueva, sin el historial del autor, con un grant de revisor y un participante con `independence_group` distinto. MADE rechaza el mismo participante o el mismo grupo.
- **Independencia estricta:** `rounds: 0`, o varias hijas con `aggregate: vote` / `children_completed:<step>:quorum:<n>`.
- **Elegir entre alternativas:** `made_run_council_decision` con contrato en modo `STRICT`.
- **Triggers externos** (alertas, issues): `made_process_trigger_event` con `external_context` construido desde KMP.

Hasta que S4 exista, las revisiones son pasos ejecutados por Pi con participantes de grupos distintos y agregación de ceremonia. La validación de evidencia queda pendiente de S4 y así se declara.

### 6.3. Aprobación humana y maker/checker

`made_approve_authorization_operation(approval_action, execution_action, scope, target_digest)` con el principal humano. El ejecutor envía `_meta.made_approval_decision_id`, y MADE exige que sea un principal distinto. `actor_kind: human` no autentica a nadie; lo que autentica es el principal.

## 7. Puente MADE → KMP (S5)

### 7.1. Qué se proyecta

Se proyectan resultados aceptados de pasos; ganadores de council y rechazados con un motivo útil; aprobaciones; guards diferidos (`statement`, `reason`, `reconsider_when`); razones de `assert_ceremony_reason`; intervenciones con respuesta; y cancelaciones con motivo.

Nunca se proyectan transcripts, razonamiento privado, deltas, heartbeats, reintentos técnicos ni artefactos completos (éstos se referencian por digest).

### 7.2. Mapeo canónico con `kmp_ingest`

| MADE | KMP |
|---|---|
| Evento aceptado | Entrada con `summary_en`; el texto original se conserva si no está en inglés |
| About de destino | El que declara la definición (`project:x`, `incident:x:17`…); si no declara ninguno, el de la sesión |
| Identidad de ceremonia | Etiquetas `ceremony`, `definition` (`name@version`), `step`, `role`, `council`, `outcome`, `run`; `labels_new` sólo en la primera aparición y `strict` después |
| `authorizes`, `chosen_because`, `supersedes`, `contradicts`, `satisfies_constraint`, `violates_constraint` | La relación homónima, con `why` y `confidence` intactos; `authorizes` y `chosen_because` con la clase requerida (`evidential`) |
| `achieved_by` | `verified_by` |
| `follows_from` | `derived_from` |
| Instante del evento en el diario | `occurred_at` |
| `admitted_at` | `observed_at` |
| Decisión reemplazada | `supersedes` → `lifecycle_state: replaced` en ask, sin borrar nada |
| Procedencia | `source_kind: projection`, `source_agent: made`, `correlation_id` = ceremonia raíz, `causation_id` = evento |
| Idempotencia | `idempotency_key` = store + evento + about + versión del mapper |

El mapeo final de `achieved_by` y `follows_from` se valida en S5 contra el vocabulario de `kmp_guide{topic: "write"}`.

### 7.3. Mecánica

- **Lectura:** `made_pull_ceremony_events` con cursor de consumidor (o `made_read_ceremony_events` por ceremonia en la recuperación).
- **Spool durable:** captura en una transacción del host y publicación con estado propio por registro; el checkpoint sólo avanza con el recibo de KMP. Se persisten los bytes canónicos antes de enviarlos; un reintento usa la misma clave y los mismos bytes.
- **Dependencias:** una publicación que referencia refs todavía no aceptadas espera explícitamente.
- **Mapper:** cambiarlo es una migración explícita, nunca una reinterpretación silenciosa del histórico.
- **Sin revisión semántica:** `ingest` no produce `needs_review`, así que el enriquecimiento semántico pertenece a la curación.

### 7.4. Ceremonia `memory_curation`

- **Disparo:** fin de una ceremonia raíz o cada N proyecciones, si la definición de origen lo activa.
- **Curador (Pi, grant de curador):**
  - `kmp_curate{mode: review, focus: <refs nuevas>, max_pairs}` para relaciones que faltan o con `why` dudoso;
  - `kmp_curate{mode: labels}` para etiquetas que faltan;
  - `kmp_summaries_audit` para `summary_en` débiles o infieles;
  - todo se entrega como candidato bajo `output_contract`.
- **Revisor (Pi, otro grupo de independencia):** acepta o rechaza cada propuesta con evidencia. Sólo lo aceptado pasa a `kmp_curate{mode: apply, review_token}`, `kmp_relabel` o `kmp_write_memory.search_summaries`. Lo que Jev deja en `curate.doubted` no se fuerza.
- **Tarjetas:** los caminos con más lecturas reciben tarjetas `kmp_condense` (compare-and-set con `expect`).
- **Gobierno:** presupuesto y diario propios de MADE; se proyecta a sí misma como cualquier otra ceremonia.

### 7.5. Lectura de vuelta

- **Pregunta tipo:** "¿qué decidimos la última vez en `release@3`?" se resuelve con `kmp_ask` y `dimensions.selectors[{key: definition, op: in, values: [release@3]}]`, más `as_of` cuando la pregunta está fechada.
- **Wake de un paso:** selectores `definition` + `step`.
- **ChronoLoom:** la ceremonia es una fila de etiqueta dentro del carril del proyecto; `paths` (curate) explica cómo se llegó a una decisión; los intents llevan `expected_revision` y el humano tiene preferencia.
- **Estado visible:** "ceremonia completada; memoria pendiente" es un estado legítimo. Si una definición exige memoria antes de terminar, declara un paso de publicación que se completa con el recibo de KMP.

## 8. Distribución (S1)

- **Paquete `pi-runtime`:**
  - extensiones `pi-underpass-host`, `pi-kmp` y `pi-made`;
  - binarios `kmp-mcp` y `made-mcp` fijados por versión y hash, descargados de sus releases y verificados;
  - sin dependencias npm de terceros salvo, como mucho, el SDK MCP de TypeScript. **Pendiente de decidir:** vendorizarlo con verificación o escribir un cliente mínimo sobre stdio.
- **`underpass setup|doctor|update`:**
  - KMP: `kmp-mcp setup --host pi` (nuevo `Host::Pi`: variante del enum, adaptador que instala la extensión en lugar de registrar MCP nativo, mapeador de estado, parser `--pi`, reglas de paridad del árbol);
  - MADE: instalación del binario y `made-mcp bootstrap-authorization <store> --policy-id --trusted-host-id`;
  - el doctor une los de ambos y añade grupos de capacidades, versión de Pi y fingerprint de los catálogos;
  - telemetría: Pi se presenta con su propio `clientInfo`.
- **Comandos de Pi:** `/catchup`, `/save`, `/restore`, `/revert` (KMP); `/ceremony design|run|status`, `/approve`, `/budget`, `/interventions` (MADE). ChronoLoom se abre por el enlace loopback de `kmp_view_open`. MCP Apps no aplica mientras Pi no sea host MCP.
- **Arranque perezoso:** las factorías de las extensiones no abren procesos, sockets ni timers; todo arranca al primer uso real, que en este runtime es la apertura de la sesión en un proyecto.

## 9. Seguridad

Hay tres capas, y ninguna sustituye a otra:

1. **Negocio: MADE.** Grants efímeros por worker, scopes `Ceremony`/`CeremonyTree`, maker/checker con principal distinto y auditoría en el diario. Revocar un grant corta el siguiente claim.
2. **Proceso: aislamiento real** de sistema de ficheros, procesos y red por worker (bwrap o contenedor). Ocultar `write` no convierte un `bash` en sólo lectura.
3. **Recursos:** un `ResourceLoader` controlado. No se heredan extensiones, prompts ni configuración de modelo del repositorio ni del directorio personal; el proyecto aporta instrucciones como datos, nunca como grants.

Otras reglas:

- Stores, spool, política y credenciales de administración quedan fuera del worktree. Los workers sólo hablan con el host por el socket restringido.
- La memoria recuperada y los bundles son evidencia delimitada, con procedencia, y nunca se interpolan como instrucciones.
- **Límite heredado de MADE:** los sistemas agénticos no tienen scope de autorización (`agentic_system_has_no_authorization_scope`). El principal de diseño y composición es separado y tiene acciones mínimas. No se promete aislamiento multitenant por sistema.

## 10. Observabilidad y medida

- **Correlación:** ceremonia raíz, ceremonia, binding, visita, paso, iteraciones, operation_id, `agent_execution_id`, incarnation, sesión Pi y `context_id` de KMP.
- **Métricas:** `made_get_metrics` + `made_get_budget_report` (coste por rol y fase a partir de `report_ceremony_agent_status`), retraso del proyector, tareas de council pendientes, renovaciones rechazadas, reconciliaciones, bytes de wake por sesión, curaciones aceptadas o rechazadas.
- **Contexto:** se miden por separado los esquemas activos, las instrucciones, el historial, el paquete KMP y los resultados de tools.
- **Banco:** Pi solo / +KMP / +MADE / composición, sobre las mismas tareas. Se mide con `memory_bench` para la recuperación y con el presupuesto de MADE para el coste. No se declara ningún ahorro sin ejecutar el banco.

## 11. Pruebas de aceptación

Se mantienen todos los casos del RFC anterior, reescritos sobre los mecanismos de este diseño (receipts de MADE en lugar de journal propio, grants en lugar de gateway). Se añaden:

| Caso | Resultado exigido |
|---|---|
| Apertura de sesión en proyecto con about | Guide y wake dentro de su presupuesto de bytes; el paquete se marca como parcial si se corta |
| Apertura sin about | Sin wake; sólo guide |
| Promoción sin confirmación | No se abre ninguna ceremonia hija |
| `agent_task_requested` duplicado o perdido | `submit_agent_output` idempotente; una tarea vencida cuenta como agente fallido |
| Revisor del mismo `independence_group` | MADE lo rechaza |
| Autor intenta aprobar su revisión | Maker/checker lo rechaza aunque el host lo permita |
| Grant caducado a mitad de ejecución | La siguiente mutación se deniega; se entra en recuperación |
| Reserva con `quality: unknown` en una dimensión limitada | Claim rechazado |
| Ingest repetido tras perder la respuesta | Misma clave y mismos bytes; ninguna entrada duplicada |
| Cambio de mapper | Se exige una migración explícita |
| Curación rechazada por el revisor | Ninguna escritura en KMP |
| Items `curate.doubted` | No se escriben sin `confirm_doubted` aprobado |
| Fork de Pi | Sucesor en MADE; ningún claim heredado |
| Selector de etiquetas en el wake de un paso | Sólo aparecen las visitas de esa definición y ese paso |

**Prueba decisiva de extremo a extremo:**

1. una sesión Pi en un proyecto real promueve una ceremonia de PR;
2. un autor Pi implementa;
3. un council Pi revisa con evidencia de KMP;
4. un humano aprueba;
5. se provoca una caída antes de completar y la recuperación no duplica efectos;
6. la proyección llega a KMP y la curación se ejecuta;
7. el wake de la sesión siguiente recupera la decisión con su `why`.

## 12. Plan por entregas

| Entrega | Contenido | Criterio |
|---|---|---|
| P0 — Contratos | MADE 0.8.0 instalado; handshake real de ambos binarios; `discover_capabilities` y `declared_limits`; medida de concurrencia en la conexión propietaria; settlement de Pi; decisión sobre el cliente MCP | Si falta una capacidad, se falla antes de ejecutar |
| P1 — S1 + S2 | Distribución, `Host::Pi`, memoria siempre activa y acotada, comandos KMP | Una sesión en un proyecto real con wake dentro de presupuesto |
| P2 — S3 | `working_session`, grants, presupuesto real, un paso con efectos, promoción, intervenciones y aprobación en la TUI, sucesión y handoff | Caída entre resultado y completion sin duplicar |
| P3 — S5 | Proyector ingest, etiquetas, `memory_curation` | La sesión siguiente recupera la decisión con su `why` |
| P4 — S4 | Adaptador delegado en MADE y councils sobre Pi con validación de evidencia | Prueba decisiva de extremo a extremo |
| P5 — S6 | AEO, Foundry y Signal Studio sobre el runtime | Cada producto ejecuta su ceremonia principal en Pi Runtime |

## 13. Decisiones tomadas

1. Pi es el único runtime, también dentro de los councils de MADE (adaptador delegado).
2. La memoria fluye por el host con DTOs: `ExternalContextBundle` hacia MADE y `kmp_ingest` hacia KMP. MADE conserva su memoria nativa (ADR-013 intacto).
3. Abouts duraderos + dimensiones de MADE como etiquetas.
4. La curación es una ceremonia maker/checker.
5. Grant efímero de MADE por worker.
6. KMP siempre activo y acotado en el runtime.
7. Toda sesión es una `working_session`; los procedimientos se promueven como ceremonias hijas previa confirmación.

## 14. Pendiente

- Cliente MCP: SDK vendorizado o cliente mínimo propio.
- Concurrencia real de `made-mcp` sobre una conexión (P0).
- Presupuesto por defecto de `working_session` y del wake de apertura (calibrar con el banco).
- Formato del perfil de rol (modelo, esfuerzo, tools, límites) y su relación con `RequestedExecutionProfile`.
- Mapeo final de `achieved_by` / `follows_from`.
- Mecanismo de aislamiento de procesos concreto por plataforma.
