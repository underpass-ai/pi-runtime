# E1 — Log de eventos de pi-runtime

**Fecha:** 29 de septiembre de 2026
**Estado:** diseño aprobado por secciones; pendiente de revisión de la spec escrita. No hay implementación.
**Depende de:** S1 (`feat/s1-distribucion`, PR #1).
**Sigue:** O1 (observabilidad) y L1 (aprendizaje continuo), que serán proyecciones de este log, cada una con su propia spec.

## 0. Propósito y límites

pi-runtime tendrá un log de eventos por proyecto: event sourcing al estilo de MADE, simplificado. Es la verdad de **lo que ocurrió en la ejecución**: sesiones, turnos, tools, modelos, compactions y el ciclo de vida del host y de los servidores. La observabilidad (O1) y el aprendizaje (L1) se derivan de él como proyecciones, que se pueden reconstruir y reentrenar reproduciendo la historia.

No duplica autoridad. MADE sigue siendo la fuente de las decisiones (ceremonias, claims, aprobaciones, presupuesto) y KMP la de la memoria. Este log solo registra hechos de ejecución y se refiere a MADE y KMP por id (spec de runtime, ADR-04 y §3).

### Decisiones tomadas

1. **Orden de trabajo:** E1 → O1 → L1. Observabilidad y aprendizaje son proyecciones del log.
2. **Contenido de los eventos:** solo metadatos y digests. Los argumentos, salidas y prompts se guardan como `sha256` y tamaño, nunca su texto.
3. **Retención:** local, sin límite y verificable. Se puede exportar a un bundle JSONL bajo demanda e importar solo por fast-forward. Nunca se commitea al repo.
4. **Captura:** la hacen las extensiones de Pi sobre los eventos públicos de Pi y el host sobre sus propios hechos. Si el host no está disponible, los hechos van a un spool de respaldo.
5. **Almacenamiento:**
   - un SQLite por proyecto en `${XDG_STATE_HOME:-~/.local/state}/pi-runtime/projects/<id>/events.sqlite3`;
   - el host es el escritor habitual (`node:sqlite` se carga en el host, arrancado con `--disable-warning=ExperimentalWarning`, y en el CLI). **Revisado (R9):** `underpass events import` y `underpass events rebuild` también escriben el log desde el CLI; la exclusión la da el bloqueo de SQLite (`BEGIN IMMEDIATE`, `busy_timeout`) y los cursores de proyección se confirman con compare-and-set (§4), así que un rebuild concurrente con el host no duplica ni pierde aplicaciones;
   - un stream por sesión de Pi y otro para el host.

### Qué se toma de MADE y KMP, y qué no

- **De MADE (ADR-012):**
  - el stream es la verdad;
  - `decide` puro y `apply` infalible y sin reloj;
  - append con versión esperada;
  - ids de evento derivados, de modo que un reintento es el mismo hecho;
  - cadena de hashes por stream con separador de dominio;
  - verificador sin estado;
  - cursores por consumidor.
- **De KMP:**
  - reconstrucción de proyecciones borrando y reproduciendo el log en una transacción;
  - bundle JSONL con cabecera y sha256;
  - merge solo por fast-forward.
- **No se copia:**
  - las tres generaciones de envelope ni la migración legacy de MADE;
  - la capa KV con blobs JSON (aquí hay columnas reales);
  - un contador de posición global en una tabla aparte (se usa `INTEGER PRIMARY KEY`);
  - releer el stream entero para conocer su cabeza (hay una tabla `streams`);
  - publishers a NATS u OTLP en E1;
  - leases y fencing entre consumidores (hay un solo consumidor por proyecto);
  - una matriz de upcasters antes de que exista una v2;
  - las guardas de commit en git de KMP.

## 1. Modelo de eventos

### 1.1. Envelope v1 (una sola forma)

| Campo | Regla |
|---|---|
| `event_id` | Derivado: `{stream}:{type}:{about}`, por ejemplo `session:abc:tool.completed:call_17`. Un reintento produce el mismo id. |
| `stream` | `host` o `session:<pi-session-id>`. |
| `version` | Contigua desde 1 dentro de cada stream. |
| `global_position` | Orden total dentro del proyecto (`INTEGER PRIMARY KEY`). |
| `type`, `type_version` | Un tipo nuevo o un campo nuevo implican una `type_version` nueva. |
| `occurred_at` | El instante en que ocurrió en Pi o en el host. No es el de llegada. |
| `recorded_at` | Lo pone el `Clock` del host al hacer el append. |
| `actor` | `{kind: human \| agent \| host, id}`. |
| `correlation_id` | El evento que abrió el stream. Lo rellena el host. |
| `causation_id` | El evento anterior del stream. Lo rellena el host. |
| `payload` | JSON canónico (claves ordenadas, sin espacios): solo metadatos y digests. |
| `prev_hash`, `hash` | Cadena por stream (§2.3). |

### 1.2. Tipos v1

| Tipo | Stream | Payload |
|---|---|---|
| `session.opened` | session | proyecto, versión de pi-runtime, versión de Pi, motivo (`startup`, `resume`, `fork`, `new`, `reload`) |
| `session.closed` | session | motivo |
| `phase.changed` | session | fase de origen, fase de destino, digest y número de las tools activas |
| `turn.completed` | session | modelo, proveedor, tokens de entrada, salida y caché, coste, duración y resultado del turno (`completed`, `aborted`, `error`) |
| `tool.started` | session | tool, servidor (`pi`, `kmp`, `made`), `call_id`, digest y tamaño de los argumentos |
| `tool.completed` | session | tool, servidor, `call_id`, duración, estado (`succeeded`, `failed`, `refused`, `aborted`), código de negativa o tipo de error, digest y tamaño de la salida |
| `model.selected` | session | modelo y esfuerzo |
| `context.compacted` | session | tokens antes y después |
| `host.started` / `host.stopped` | host | versión, huellas de catálogo y motivo |
| `server.started` / `server.exited` | host | servidor, versión y código de salida |

### 1.3. Reglas

- `refused` y `aborted` son estados distintos de `failed`. En runtime un `denied` contaba como fallo, y eso contamina el aprendizaje.
- **Nunca** se guarda texto de prompts, argumentos o salidas, ni rutas o nombres de fichero que aparezcan en ellos: solo `sha256` y tamaño.
- El lector acepta solo los `(type, type_version)` que conoce. Los upcasters llegarán cuando exista una v2.

### 1.4. Agregado de sesión

- **Estado:** fase, tools activas (digest), modelo actual, contadores de turnos, tokens, coste y llamadas por servidor y estado, y abierta o cerrada.
- `decide(state, command, clock, ids) → facts[] | rejection` es puro. **(R10)** `session.opened` sobre una sesión abierta es una reapertura implícita (Pi murió sin `session.closed` y la sesión se reanuda): se acepta.
- `apply(state, record) → state` es infalible, no lee el reloj y no valida. Rechaza de forma explícita un stream que no empiece por `session.opened`.

## 2. Almacenamiento e integridad

### 2.1. Esquema

SQLite con `STRICT`, WAL, `synchronous=FULL`, `busy_timeout=10000` y escrituras en `BEGIN IMMEDIATE`:

- `events(global_position INTEGER PRIMARY KEY, stream TEXT NOT NULL, version INTEGER NOT NULL, event_id TEXT NOT NULL, type TEXT NOT NULL, type_version INTEGER NOT NULL, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, correlation_id TEXT NOT NULL, causation_id TEXT, payload TEXT NOT NULL, prev_hash TEXT, hash TEXT NOT NULL, UNIQUE(stream, version), UNIQUE(stream, event_id))`. **Revisado (R9):** el actor se guarda en dos columnas reales (`actor_kind`, `actor_id`) en vez de un `actor` JSON.
- `streams(stream TEXT PRIMARY KEY, version INTEGER NOT NULL, head_hash TEXT NOT NULL, last_event_id TEXT NOT NULL, correlation_id TEXT NOT NULL)`: la cabeza se lee en O(1). **Revisado (R9):** `last_event_id` y `correlation_id` permiten rellenar `causation_id` y `correlation_id` del siguiente append sin releer el stream.
- `cursors(consumer TEXT PRIMARY KEY, projection_version INTEGER NOT NULL, position INTEGER NOT NULL)`.
- `projection_state(consumer TEXT, key TEXT, value TEXT, PRIMARY KEY(consumer, key))`: estado de las proyecciones durables.
- `projection_quarantine(consumer TEXT, global_position INTEGER, reason TEXT, PRIMARY KEY(consumer, global_position))`.
- `meta(key TEXT PRIMARY KEY, value TEXT)`, con `schema_version`.

### 2.2. Contrato de append (puerto `EventStore`)

- `append(stream, expectedVersion, facts[])` devuelve una de dos cosas:
  - `Appended{version, firstPosition, records}`;
  - `Conflict{expected, actual}`. Un conflicto es un valor, no una excepción.
- Todo o nada.
- Un `event_id` que ya existe en el stream es **idempotente**: si el payload canónico coincide, devuelve el registro existente; si difiere, devuelve `Conflict`.
- `sealContinuation(head, facts)` es pura y vive en el dominio. Rechaza un lote vacío, un hecho de otro stream o un id duplicado dentro del lote, asigna las versiones y encadena los hashes. Ningún adaptador calcula eslabones por su cuenta.
- Lectura:
  - `readStream(stream, fromVersion?)`;
  - `readAll(fromPosition, limit)`;
  - `head(stream)`.
- **Suite de conformidad única**, que corre contra el adaptador en memoria y contra el de SQLite. Cubre:
  - versiones contiguas;
  - conflicto por versión obsoleta sin escribir nada;
  - un único ganador con dos procesos concurrentes (solo en SQLite);
  - idempotencia con el mismo payload y conflicto con uno distinto;
  - cadena intacta;
  - orden y estabilidad de `readAll`.

### 2.3. Integridad

- `hash = sha256("pi-runtime.event.v1" ‖ len‖campo … ‖ payload canónico ‖ prev_hash)`, con campos de longitud prefijada en un orden fijo.
- `verifyStream(records)` es sin estado:
  - la versión 1 no tiene `prev_hash`;
  - cada registro pertenece al mismo stream, su versión es la siguiente, su `prev_hash` coincide con el hash anterior y su hash se recalcula igual.
  - Devuelve `Intact` o `Broken{version, reason}`, deteniéndose en el primer defecto. Un stream vacío es `NotFound`, no `Intact`.
- **Export:** JSONL con una cabecera `{format: "pi-runtime.events.v1", project_id, from, to, count, sha256}` y después un registro por línea.
- **Import:** solo por fast-forward de un prefijo exacto por stream; una historia divergente se rechaza sin escribir nada.

## 3. Captura

### 3.1. En Pi (adaptador de entrada)

- `EventCaptureExtension` escucha:
  - `session_start` y `session_shutdown`;
  - `turn_end` (uso del mensaje del asistente);
  - `tool_execution_start` y `tool_execution_end`;
  - `model_select`;
  - la compaction;
  - `agent_settled`.
- `FactMapper` convierte cada evento de Pi en un `FactDto` con metadatos, digest y tamaño y el `event_id` derivado. Nunca copia contenido.
- Las tools de KMP y MADE que pasan por `PiToolFactory` añaden el servidor, el código de negativa y el tipo de error (`refused`, `rpc`, `transport`, `aborted`).
- **Envío:** método IPC `record`, de solo escritura y con esquema cerrado. Es sin espera: la sesión de Pi nunca se bloquea por el log.
- **Spool de respaldo:** si el host no responde, los hechos van a `.../projects/<id>/spool/<pid>.jsonl` (0600, tope de 10 MB, un fichero por proceso). Al reconectar se reenvían en orden y se borran tras confirmarse. Hay un único sink (y un único drain) por proceso y fichero de spool, compartido entre sesiones; los envíos directos se encadenan, y en cuanto uno acaba en el spool los siguientes van detrás de él.
- **Adopción de spools huérfanos (R9):** si el proceso de Pi muere con hechos en su spool, nadie volvería a reenviarlos. El host, al arrancar y en cada tick de 5 s, reclama los `<pid>.jsonl` cuyo pid ya no existe con un rename atómico a `<pid>.jsonl.draining`, registra cada hecho por `RecordFact` (idempotente, así que un drain a medias se puede repetir), cuenta los inválidos y borra el fichero. Los `.draining` que dejó un host muerto se recogen igual; los marcadores `.gap` se conservan para `doctor`. **Revisado:** un `.draining` que no se puede registrar (por ejemplo, el log bloqueado) no se reintenta en cada tick: el servicio de adopción del host guarda un retroceso por fichero (5 s tras el primer fallo, doblando hasta un tope de 5 min) que se reinicia al adoptarlo, y en `host.log` sólo deja constancia de los cambios de estado (el primer fallo, la recuperación y cada adopción), no de cada reintento.
- Si se pierde el spool (por ejemplo, un disco lleno), queda un hueco y se avisa en `doctor`. Nunca se inventan eventos **Revisado:** el hueco queda como marcador `<pid>.gap` y `doctor` falla mientras exista, indicando el remedio: revisar los hechos perdidos y ejecutar `underpass events ack-gaps`, que lista los marcadores del spool del proyecto, los borra e imprime cuántos reconoció (sin abrir ni crear el log).

### 3.2. En el host

- `ServerPool` registra servidor arrancado o caído, `HostComposition` registra host arrancado o detenido (con las huellas) y el cambio de fase se registra desde `/underpass-phase`. Todo pasa por el mismo caso de uso `RecordFact`, sin IPC.

### 3.3. Caso de uso `RecordFact`

- Valida el DTO y lo convierte en VOs.
- Carga el agregado: el snapshot en memoria del host más la cola del stream.
- Llama a `decide` y hace el append con la versión esperada.
- Ante un `Conflict`, recarga y reintenta hasta 3 veces; si sigue fallando, devuelve un error de transporte, y la extensión lo manda al spool.
- Garantías: entrega al menos una vez, append idempotente por `event_id` y orden de llegada dentro de cada stream.

## 4. Proyecciones y cursores

- Una proyección es una clase con `name`, `version` y `apply(record)`, pura y sin reloj.
- `ProjectionRunner`:
  - lee `readAll` desde `cursor.position + 1` en lotes;
  - aplica los eventos y guarda el estado y el cursor **en la misma transacción**, así que el procesamiento es exactamente una vez;
  - **(R9)** parte de una instantánea consistente (cursor y estado) y confirma con compare-and-set sobre el cursor (`UPDATE … WHERE projection_version = ? AND position = ?`); si otro escritor (el CLI) lo movió, descarta la pasada y la repite desde la instantánea nueva. Un `reset` invalida las pasadas en vuelo;
  - se dispara después de cada append y además cada 5 s.
- Si la `version` de una proyección no coincide con la del cursor, se borra su estado y se reconstruye reproduciendo desde 0 en una transacción.
- **Cuarentena:** un evento que hace fallar la proyección 3 veces se aparta con su motivo y la proyección continúa.
- **Proyecciones de E1:**
  - `session_summary`: por sesión, fase, duración, turnos, tokens, coste, llamadas por servidor y estado, y fallos. **Revisado (versión 2):** un `session.opened` sobre una sesión aún abierta (reapertura implícita tras caerse Pi) o tras `session.closed` (resume) no reinicia nada: `openedAt` conserva la primera apertura, `closedAt` se borra hasta el siguiente cierre y los contadores siguen acumulando sin contar dos veces; el agregado `SessionAggregate` hace lo mismo (sigue abierta y acumula).
  - `tool_stats`: por tool y servidor, `n`, éxitos, fallos, negativas, abortos, duraciones p50 y p95 (reservorio acotado) y la última vez vista. Es el equivalente del `ToolStats` de underpass-runtime y la base común de O1 y L1.
- **Puntos de extensión para después:** O1 añadirá proyecciones de métricas y un exportador; L1, las proyecciones de posteriores y de decisiones. Las dos leen por su propio cursor, y reentrenar consiste en subir la `version`.

## 5. CLI, diagnóstico y pruebas

### 5.1. CLI

- `underpass events sessions [--since]`
- `underpass events show <session>`: la línea temporal, solo con metadatos.
- `underpass events tools`
- `underpass events verify [--stream]`
- `underpass events export [--since] > bundle.jsonl` y `underpass events import bundle.jsonl` (si el `project_id` de la cabecera no es el del proyecto, se importa igual y se avisa)
- `underpass events rebuild <projection>`
- `underpass events ack-gaps`: reconoce los huecos del spool (borra los `.gap` tras revisarlos) para que `doctor` deje de fallar por ellos.
- `/underpass-status` en Pi añade la sesión actual (turnos, tokens, coste, llamadas y fallos) y el estado del log (posición y verificación). **Revisado (R3/R9):** el método IPC `summary` devuelve el resumen de la sesión junto con el estado del log (`logPosition` y si la cadena del stream de la sesión está intacta), en una sola llamada.
- `underpass doctor` añade: log presente, cadena íntegra, proyecciones al día, spool vacío y cuarentena vacía.

### 5.2. Pruebas

- **Dominio:** VOs del envelope; `sealContinuation`; `verifyStream` con cada defecto (hash alterado, hueco de versión, stream mezclado, `prev_hash` en la versión 1); `decide` y `apply` del agregado, con la propiedad de que reproducir desde cero da el mismo estado.
- **Suite de conformidad del `EventStore`:** la misma batería contra memoria y SQLite, más la concurrencia de dos procesos en SQLite.
- **Captura:**
  - `FactMapper` con fixtures sacados de la forma real de los eventos de Pi 0.87.1;
  - un test afirma que ningún payload contiene cadenas de los argumentos o salidas de entrada;
  - spool con el host caído, reenvío y ausencia de duplicados.
- **Proyecciones:** reconstruir desde 0 da lo mismo que el procesamiento incremental; cuarentena.
- **Aceptación en la máquina real:**
  1. una sesión de Pi con llamadas a KMP produce la línea temporal esperada;
  2. `verify` sale intacto;
  3. se mata el host a mitad de sesión y al volver el spool se reenvía sin duplicados;
  4. `export` e `import` en un proyecto vacío reproducen el mismo log.

### 5.3. Estándar

Hexagonal y DDD (VOs, puertos, DTOs, mappers y casos de uso), una clase por fichero, cobertura de al menos el 80 % y sin dependencias npm. Se aplican los gates de arquitectura existentes.

## 6. Pendiente

- Validar `node:sqlite` en el host: comportamiento bajo el flag de warning y rendimiento de WAL con append por evento.
- Retención a largo plazo: si el log crece mucho, compactar con snapshots sellados. Queda fuera de E1.
- Forma exacta de `turn_end` y de la compaction en Pi 0.87.1: confirmarla contra los fixtures antes de fijar los payloads.
