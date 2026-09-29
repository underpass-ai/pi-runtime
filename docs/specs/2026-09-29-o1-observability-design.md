# O1 — Observabilidad de Pi Runtime

- **Fecha:** 2026-09-29
- **Estado:** aprobada por Tirso, sección a sección
- **Depende de:** E1 (log de eventos por proyecto), `docs/specs/2026-09-29-e1-event-log-design.md`
- **Modelo:** la observabilidad de underpass-runtime: spans por invocación, contadores, histograma de duración, KPIs, OTLP/HTTP, texto Prometheus, logs JSON con `trace_id`, alertas y dashboard.

## 0. Decisiones

1. **Local primero, OTLP opcional.** Todo se calcula y se ve en local sin infraestructura. Solo si `OTEL_EXPORTER_OTLP_ENDPOINT` está definida, el host empuja trazas y métricas por OTLP/HTTP.
2. **Señales:**
   - tools, como en el runtime;
   - modelo: turnos, tokens y coste;
   - sesión y host;
   - KPIs de calidad calculables con los hechos que ya captura E1.
3. **Alertas solo como artefactos.** Se versionan un `PrometheusRule` y un dashboard de Grafana; en local no se evalúa ninguna regla.
4. **Todo sale del log.** O1 no añade captura nueva. Métricas y KPIs son proyecciones de E1, y las trazas las reconstruye un exportador con cursor propio. El resultado es reproducible y se puede reexportar sin duplicados.

## 1. Arquitectura

| Pieza | Capa | Qué hace |
|---|---|---|
| `TelemetryMetricsProjection` | application/projections | Contadores acumulados e histograma. |
| `QualityKpisProjection` | application/projections | KPIs globales y por sesión. |
| `SpanAssembler` | domain/telemetry | Convierte hechos ordenados en spans cerrados. Es puro y tiene estado explícito. |
| `TraceExport` (caso de uso) | application/use-cases | Avanza el cursor `otlp_traces`, ensambla y envía por el puerto `TelemetrySink`. |
| `MetricsExport` (caso de uso) | application/use-cases | Cada 15 s lee las proyecciones y envía un snapshot acumulado. |
| `OtlpHttpTelemetrySink` | adapters/outbound/otlp | Mapea a OTLP JSON y hace `POST /v1/traces` y `/v1/metrics` con `fetch` nativo. |
| `PrometheusTextRenderer` | adapters/inbound/cli | Formato de exposición de Prometheus. |
| `JsonLineLogger` | adapters/outbound/log | Log del host en JSON por líneas, con `trace_id` y `span_id`. |
| Artefactos | `deploy/observability/` | `pi-runtime.rules.yaml` (PrometheusRule) y `pi-runtime.dashboard.json`. |

Las reglas de E1 siguen vigentes:
- hexagonal, DDD sin primitive obsession;
- un tipo por fichero;
- cobertura ≥ 80 %;
- cero dependencias npm;
- ningún contenido sensible (textos de prompt, argumentos o salidas, ni rutas).

## 2. Métricas

Solo contadores acumulados. Las tasas y los percentiles los calcula Prometheus o Grafana; en local los p50/p95 se estiman con el histograma.

| Métrica | Tipo | Labels |
|---|---|---|
| `pi_runtime_tool_invocations_total` | counter | `tool`, `server`, `status` (`succeeded`, `failed`, `refused` o `aborted`) |
| `pi_runtime_tool_refused_total` | counter | `tool`, `reason` (el `errorCode` acotado o `unknown`) |
| `pi_runtime_tool_duration_ms` | histogram | `tool`, `server`; buckets 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000 |
| `pi_runtime_turns_total` | counter | `model`, `provider`, `outcome` |
| `pi_runtime_tokens_total` | counter | `model`, `provider`, `kind` (`input`, `output`, `cache_read` o `cache_write`) |
| `pi_runtime_cost_total` | counter | `model`, `provider` (en la unidad que reporta Pi) |
| `pi_runtime_sessions_total` | counter | `event` (`opened`, `closed` o `reopened`) |
| `pi_runtime_compactions_total` | counter | `reason` |
| `pi_runtime_server_starts_total` / `pi_runtime_server_exits_total` | counter | `server`; las salidas llevan además `code` (código o `unknown`) |

**Almacenamiento:** va en `projection_state` del consumidor `telemetry_metrics`, con estas claves:
- `counter|<nombre>|<labels canónicos>` → número.
- `hist|<nombre>|<labels>` → `{buckets: number[11], sum, count}`.

**Cardinalidad acotada:**
- Los nombres de tool, servidor, modelo y proveedor vienen del catálogo y del proveedor.
- Nunca va texto de error en un label.
- Un label de más de 64 caracteres o con caracteres fuera de `[A-Za-z0-9_.:-]` se sustituye por `other`.

**Inicio del acumulado:** se fija en la primera proyección, se guarda en `meta` (`telemetry_start`) y sobrevive a los reinicios del host. Al hacer rebuild se reinicia, y el exportador lo comunica como un reinicio de contador.

## 3. KPIs de calidad

Los calcula `quality_kpis` de forma global y por sesión:

- **Éxito a la primera:** proporción de tools cuya primera invocación dentro del turno sale `succeeded`, sin un fallo previo de esa misma tool en el turno.
- **Tasa de negativas:** `refused` / invocaciones.
- **Por sesión:** turnos, coste y tokens.
- **Ratio de caché:** `cache_read` / (`input` + `cache_read`).
- **Compactaciones por sesión.**

Los KPIs de aceptación de recomendaciones del runtime se dejan para L1.

## 4. Trazas

**Ids deterministas:**
- `trace_id` = primeros 16 bytes de `sha256("pi-runtime.trace" ‖ stream)`.
- `span_id` = primeros 8 bytes de `sha256("pi-runtime.span" ‖ event_id del hecho que abre el span)`.

**Spans de sesión:**
- **`session`:** abre con `session.opened` y cierra con `session.closed`. Una reapertura cierra el span en curso (atributo `pi_runtime.reopened=true`) y abre otro en la misma traza.
- **`turn`:** su inicio es `occurredAt − durationMs` de `turn.completed` y su fin, `occurredAt`. Hijo de `session`. Lleva modelo, proveedor, tokens, coste, outcome y stopReason.
- **`tool`:** va del `tool.started` al `tool.completed` del mismo `callId`. Hijo del turno en curso, o de la sesión si no hay turno abierto. Lleva tool, servidor, estado, errorKind, errorCode y bytes.
  - Un `failed` se emite con status ERROR.
  - `refused` y `aborted` se emiten con status UNSET y el atributo `pi_runtime.status`.
- **Eventos de span:** `phase.changed`, `model.selected` y `context.compacted` se añaden a `session`.
- **Incompletos:** un `tool.started` sin cierre se emite al cerrar la sesión o a los 10 min de `recordedAt`, con status UNSET y `pi_runtime.incomplete=true`. Si el cierre llega después, se ignora, porque el span ya salió.
- **Sesiones abandonadas:** una sesión sin `session.closed` se cierra a las 24 h de su último hecho (por `recordedAt`), con `pi_runtime.incomplete=true` y fin en el `occurredAt` de ese último hecho, y sale del estado del ensamblador. El "ahora" es el mismo que para las tools (reloj de pared con el log al día; si no, el `recordedAt` más alto leído) y, además, un hecho de esa sesión grabado 24 h o más después del anterior la cierra antes de procesarse: el replay del log da los mismos spans que la exportación en vivo. Un cierre o cualquier hecho posterior de esa sesión se ignora; una reapertura abre un span nuevo en la misma traza.

**Host:** cada `host.started` abre la traza de ese arranque (stream `host` + id del hecho). Contiene:
- un span `host` que dura hasta `host.stopped`;
- spans `mcp_server` que van de `server.started` a `server.exited`, con su código de salida.

**Recurso:**
- `service.name=pi-runtime`, `service.version`, `pi_runtime.project` y `service.instance.id`.
- `pi_runtime.project` y `service.instance.id` llevan el mismo valor: `HMAC-SHA256(clave, ProjectId)`, primeros 16 hex. Así las series de dos proyectos no chocan (Prometheus las distingue por `job` + `instance`) y el valor no se puede revertir adivinando rutas, como sí pasaría con el hash sin sal del `ProjectId`.
- La clave es un secreto por instalación: 32 bytes aleatorios en `<state>/telemetry.key` (0600, creada de forma atómica la primera vez que el host exporta; nunca rota). Nunca aparece en logs, errores, `doctor` ni en la telemetría. Si no se puede leer o crear (permisos abiertos, symlink, contenido inválido), el host no exporta y lo avisa una vez, sin ruta ni valor.
- Se respeta `OTEL_RESOURCE_ATTRIBUTES`, salvo claves de máquina o usuario y valores con rutas; un `service.instance.id` del usuario se descarta porque lo fija el runtime.
- Nunca se envían el hostname, el usuario ni rutas.

**Estado del ensamblador:** los spans abiertos y los incompletos pendientes se guardan en `projection_state` del consumidor `otlp_traces`, con el mismo commit con compare-and-set que en E1. Un reinicio no pierde spans.

## 5. Exportación

- **Activación:** solo si `OTEL_EXPORTER_OTLP_ENDPOINT` está definida. El endpoint tiene que ser `https://`, salvo que el host sea `localhost`, `127.0.0.1` o `[::1]`.
- **Formato:** OTLP/HTTP JSON (`Content-Type: application/json`). Tanto gRPC como protobuf quedan fuera de alcance.
- **Trazas:**
  - lotes de hasta 512 spans a `{endpoint}/v1/traces`;
  - el cursor avanza solo tras un 2xx;
  - si llega un 4xx que no sea 429, el lote se descarta con un aviso;
  - un 5xx, un 429 o un error de red provocan reintento.
- **Métricas:**
  - snapshot acumulado a `{endpoint}/v1/metrics` cada 15 s;
  - temporalidad `CUMULATIVE`, con `startTimeUnixNano` = `telemetry_start`;
  - si un envío falla, se envía el siguiente snapshot y no hay cola.
- **Reintentos:** espera progresiva de 1 s hasta un máximo de 5 min.
- **Aislamiento:** la exportación no bloquea al host ni a Pi, y los errores se registran como mucho una vez por cambio de estado.
- **Cabeceras:**
  - salen de `OTEL_EXPORTER_OTLP_HEADERS` (formato estándar `k=v,k2=v2`);
  - nunca aparecen en logs, errores ni `doctor`, que solo muestra sus nombres;
  - `OTEL_EXPORTER_OTLP_TIMEOUT` (ms, por defecto 10000).
- **Idempotencia:** reexportar, por ejemplo después de un rebuild, produce los mismos ids.

## 6. Superficies locales

- `underpass metrics [--session <id>]`: formato de exposición de Prometheus (`# HELP`, `# TYPE`, labels ordenados, histograma con `_bucket{le=…}`, `_sum` y `_count`).
- `underpass events kpis [--session <id>]`: los KPIs en tabla.
- `underpass events trace <session>`: árbol de spans en texto (nombre, duración, estado, tokens y coste por turno).
- `/underpass-status`: añade una línea de KPIs de la sesión y otra con el estado del exportador (`otlp: disabled` · `otlp: ok, lag N` · `otlp: failing since <ts>`).
- `doctor`: añade dos comprobaciones.
  - `telemetry projections`: al día y sin cuarentena.
  - `otlp exporter`:
    - `OK disabled` si no hay endpoint;
    - `OK` si va al día;
    - `WARN` si va más de 5 min atrasado;
    - `FAIL` si el endpoint no es válido o no es HTTPS fuera de localhost.

## 7. Log del host

- JSON por líneas: `ts`, `level`, `msg`, `trace_id` y `span_id` opcionales, y campos adicionales.
- Nunca incluye contenido de prompts, argumentos ni salidas, ni cabeceras OTLP.
- Rotación a 10 MB, conservando los 3 ficheros anteriores (`host.log.1` a `host.log.3`).
- Las líneas actuales de texto libre del host pasan a este formato.

## 8. Artefactos (`deploy/observability/`)

- **`pi-runtime.rules.yaml`** (PrometheusRule). Adapta las alertas del runtime:
  - fallos de tools > 5 % durante 10 min;
  - negativas > 0,5/s durante 10 min;
  - p95 de duración de tools > 2 s durante 10 min;
  - `absent(pi_runtime_sessions_total)` durante 30 min, a título informativo.
- **`pi-runtime.dashboard.json`** (Grafana): invocaciones por estado, p50/p95 por tool, tokens y coste por modelo, sesiones y compactaciones, y salidas de servidores MCP.
- **Test:** los ficheros son válidos y todas las métricas que referencian existen en `TelemetryMetricsProjection`.

## 9. Errores

- Las proyecciones son tolerantes: un payload inesperado cuenta como dato ausente. Solo los errores de programación van a la cuarentena de E1.
- El exportador nunca propaga errores al host.
- Un fallo de configuración (endpoint inválido) desactiva la exportación y lo muestra en `doctor`.

## 10. Pruebas y aceptación

**Unitarias:**
- Proyecciones sobre logs de ejemplo, en memoria y en SQLite.
- `SpanAssembler`: emparejado, padres, incompletos, reapertura, ids deterministas y reinicio a mitad de lote.
- Mapeo a OTLP JSON contra muestras del esquema de OpenTelemetry.
- Texto Prometheus.
- Validez de los artefactos.

**Integración:** un colector OTLP falso (un HTTP local en el test) debe cubrir:
- recepción de trazas y métricas;
- caída del colector y reintento;
- 4xx descartado;
- reexportación sin duplicados;
- reinicio del host a mitad de lote.

**Aceptación en la instalación real:**
- `underpass metrics`, `events kpis` y `events trace` sobre el log real de kmp;
- exportación a un receptor OTLP de prueba local que guarde el JSON recibido;
- comprobar trazas completas y que no hay contenido sensible;
- `doctor` en verde.

## 11. Fuera de alcance

- Evaluar alertas en local.
- KPIs de recomendación (L1).
- Muestreo de trazas.
- OTLP en gRPC o protobuf.
- Levantar un stack local de Prometheus y Grafana.
