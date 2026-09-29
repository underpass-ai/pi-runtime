# O1 Observabilidad — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derivar del log de eventos de E1 métricas acumuladas, KPIs de calidad y trazas deterministas; verlas en local (`underpass metrics`, `events kpis`, `events trace`, `/underpass-status`, `doctor`) y, sólo si `OTEL_EXPORTER_OTLP_ENDPOINT` está definida, empujarlas por OTLP/HTTP JSON; pasar el log del host a JSON por líneas con rotación; versionar reglas de Prometheus y un dashboard de Grafana.

**Architecture:** El dominio (`src/domain/telemetry/`) tiene el catálogo de métricas y sus VOs (labels acotados, claves de estado, histograma), el modelo de spans con ids deterministas (sha256 con encuadre de longitud), el `SpanAssembler` puro con estado explícito y serializable, y la configuración OTLP (endpoint, cabeceras, recurso). La aplicación añade dos proyecciones del runner de E1 (`telemetry_metrics`, `quality_kpis`), el exportador de trazas con cursor propio (`otlp_traces`, compare-and-set de E1), el de métricas (snapshot acumulado cada 15 s), el servicio de exportación con retroceso y los casos de uso de lectura y diagnóstico. Los adaptadores son el mapeo a OTLP JSON y el `fetch` nativo, el renderizador Prometheus, el logger JSON con rotación, el `meta` de SQLite para el inicio del acumulado y las superficies de CLI y de Pi.

**Tech Stack:** Node 22.23 (type stripping, `node:test`, `node:sqlite`, `node:crypto`, `fetch` y `AbortSignal.timeout` nativos, `node:http` sólo en tests), TypeScript borrable, Pi 0.87.1. Sin dependencias npm.

**Spec:** `docs/specs/2026-09-29-o1-observability-design.md` (y, como contexto, `docs/specs/2026-09-29-e1-event-log-design.md`).

## Global Constraints

- **Hexagonal y DDD, sin primitive obsession:**
  - `src/domain/**` sólo importa `domain` y `node:crypto`; `src/application/**` sólo importa `domain` y `application`, nunca `node:*`.
  - `node:sqlite` sólo en `src/adapters/outbound/sqlite/`. `src/adapters/**` nunca importa `composition`.
  - Los paquetes externos sólo se importan bajo `src/adapters/inbound/pi/`. **Cero dependencias npm:** nunca `npm install`.
  - Una clase, `export interface` o `export type X =` por fichero en `src/` (los `type` no exportados dentro de un fichero no cuentan). Los VOs que extienden `ValueObject` tienen constructor privado.
  - Los conceptos de telemetría son VOs o clases de dominio (`LabelValue`, `MetricLabels`, `MetricKey`, `HistogramValue`, `TraceId`, `SpanId`, `SpanStatus`, `SpanAttributes`, `OtlpEndpoint`, `OtlpHeaders`…). Los DTOs son primitivos. Todo `of(raw: string)` rechaza `typeof raw !== "string"` con `DomainError`.
  - Todos los tests de `tests/architecture/` siguen en verde.
- **Cobertura ≥ 80 %** de líneas, ramas y funciones con `npm test` (`bash scripts/test.sh`).
- **TypeScript borrable:** sin `enum`, `namespace`, parameter properties ni decoradores; imports relativos con `.ts`.
- **Nada sensible, en ningún sitio** (spans, atributos, recurso OTLP, métricas, labels, `host.log`, errores, `doctor`, `/underpass-status`): ni texto de prompts, argumentos o salidas; ni rutas; ni hostname, usuario o endpoint; ni **valores** de cabeceras OTLP (sólo sus nombres). Los mensajes de error de la configuración OTLP nunca repiten la entrada.
- **Labels acotados:** un valor de más de 64 caracteres o con caracteres fuera de `[A-Za-z0-9_.:-]` se sustituye por `other`; un valor ausente es `unknown`. Nunca texto de error en un label.
- **Métricas** (nombres exactos de la spec): `pi_runtime_tool_invocations_total{tool,server,status}`, `pi_runtime_tool_refused_total{tool,reason}`, `pi_runtime_tool_duration_ms{tool,server}` (buckets `10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000`), `pi_runtime_turns_total{model,provider,outcome}`, `pi_runtime_tokens_total{model,provider,kind}` (`input`, `output`, `cache_read`, `cache_write`), `pi_runtime_cost_total{model,provider}`, `pi_runtime_sessions_total{event}` (`opened`, `closed`, `reopened`), `pi_runtime_compactions_total{reason}`, `pi_runtime_server_starts_total{server}`, `pi_runtime_server_exits_total{server,code}`.
- **Estado de `telemetry_metrics`:** `counter|<nombre>|<labels canónicos>` → número; `hist|<nombre>|<labels>` → `{buckets: number[11], sum, count}`. Labels canónicos: `k=v` ordenados por nombre y unidos con `,`.
- **Ids deterministas:** `trace_id` = primeros 16 bytes de `sha256("pi-runtime.trace" ‖ stream)` (host: `‖ "host" ‖ event_id del host.started`); `span_id` = primeros 8 bytes de `sha256("pi-runtime.span" ‖ event_id que abre el span)`. `‖` usa el mismo encuadre que la cadena de E1: cada parte como `"<bytesUtf8>:<valor>"`.
- **OTLP:** HTTP JSON (`Content-Type: application/json`) a `{endpoint}/v1/traces` (lotes ≤ 512 spans) y `{endpoint}/v1/metrics` (cada 15 s, `CUMULATIVE` = `aggregationTemporality: 2`, `startTimeUnixNano` = inicio del acumulado). Endpoint `https://` salvo `localhost`, `127.0.0.1` o `[::1]`. `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k2=v2`), `OTEL_EXPORTER_OTLP_TIMEOUT` (ms, 10000 por defecto), `OTEL_RESOURCE_ATTRIBUTES` respetado salvo claves de máquina/usuario y valores con rutas. 2xx avanza el cursor; 4xx ≠ 429 descarta con aviso; 5xx, 429 o red reintentan con espera de 1 s doblando hasta 5 min.
- **Log del host:** JSON por líneas (`ts`, `level`, `msg`, `trace_id`/`span_id` opcionales y campos), rotación a 10 MB con `host.log.1` … `host.log.3`.
- **Tests:** en español, con `node:test` y `node:assert/strict`, en `tests/unit/<capa>/…` reflejando `src`.
- **Commits** en español con prefijo convencional, en la rama `feat/o1-observability`, con `git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit …`.

---

## Mapa de ficheros

```text
src/domain/telemetry/     MetricKind (type), MetricDescriptor, MetricCatalog, LabelValue, MetricLabels, MetricKey,
                          HistogramValue, MetricPoint, MetricsSnapshot, TelemetryDigest, TraceId, SpanId, SpanStatus,
                          SpanAttributes, SpanEvent, SpanJson (type), Span, AssemblerState (type), SpanAssembler,
                          ExportResult, OtelKeyValueList, TelemetryResource, TelemetryEpoch,
                          OtlpEndpoint, OtlpHeaders, OtlpSettings, OtlpConfiguration
src/domain/diagnosis/CheckSection.ts                (+ TELEMETRY)
src/application/ports/    TelemetrySink, TelemetryEpochStore, HostLog
src/application/dto/      KpiTallyDto, QualityKpisDto, SpanRowDto, ExporterStatusDto, SessionStatusDto (+kpis, +exporter)
src/application/projections/ TelemetryMetricsProjection, QualityKpisProjection
src/application/services/ ExportBackoff, TelemetryEpochs, ExporterHealth, TelemetryExporter
src/application/use-cases/ ReadTelemetryMetrics, QualityKpisReport, TraceExport, MetricsExport, SessionTrace,
                           DiagnoseTelemetry, RebuildProjection (+otlp_traces, +epoch), ReadSessionStatus (+kpis, +exporter)
src/adapters/outbound/otlp/   OtlpJsonMapper, OtlpHttpTelemetrySink
src/adapters/outbound/sqlite/ SqliteTelemetryEpochStore
src/adapters/outbound/memory/ InMemoryTelemetryEpochStore
src/adapters/outbound/log/    JsonLineLogger
src/adapters/inbound/cli/     PrometheusTextRenderer, MetricsCli, EventsCli (+kpis, +trace), UnderpassCli (+metrics)
src/adapters/inbound/pi/      HostExtension (+líneas kpis y otlp)
src/composition/  TelemetryEnvironment, StatePaths (+hostStderrOf), HostComposition, EventLogComposition,
                  CliComposition, ExtensionComposition (stderr del host aparte)
deploy/observability/  pi-runtime.rules.yaml, pi-runtime.dashboard.json
tests/acceptance/      otlp-receiver.ts
docs/acceptance/       o1.md
```

Orden de dependencias: 1 → 2 → 3 (métricas y KPIs) · 4 → 5 (spans) · 6 → 7 → 8 (exportación) · 9, 10 (superficies CLI) · 11 → 12 (host) · 13 (doctor) · 14 (artefactos) · 15 (aceptación).

---

### Task 1: Catálogo de métricas, labels acotados e histograma

**Files:**
- Create: `src/domain/telemetry/{MetricKind,MetricDescriptor,MetricCatalog,LabelValue,MetricLabels,MetricKey,HistogramValue}.ts`
- Test: `tests/unit/domain/telemetry/metrics.test.ts`

**Interfaces:**
- Produces:
  - `type MetricKind = "counter" | "histogram"`
  - `MetricDescriptor.counter(name, help, labelNames: string[], integer = true)`, `MetricDescriptor.histogram(name, help, labelNames)`; campos `name`, `kind`, `help`, `labelNames` (ordenados), `integer`
  - `MetricCatalog.{TOOL_INVOCATIONS, TOOL_REFUSED, TOOL_DURATION, TURNS, TOKENS, COST, SESSIONS, COMPACTIONS, SERVER_STARTS, SERVER_EXITS}`, `MetricCatalog.ALL`, `MetricCatalog.find(name): MetricDescriptor | null`
  - `LabelValue.of(raw: string)`, `LabelValue.orUnknown(raw: unknown)`, `LabelValue.OTHER`, `LabelValue.UNKNOWN`, `.value`
  - `MetricLabels.of(values: Record<string, LabelValue>)`, `MetricLabels.parse(text)`, `MetricLabels.NONE`, `.text`, `.entries(): [string, string][]`, `.names(): string[]`, `.get(name): string | null`, `.equals(o)`
  - `MetricKey.of(descriptor, labels)`, `MetricKey.parse(raw): MetricKey | null`, `.descriptor`, `.labels`, `.text`
  - `HistogramValue.BOUNDS`, `HistogramValue.EMPTY`, `HistogramValue.fromJson(raw: unknown)`, `.observe(ms)`, `.toJson()`, `.bucketCounts(): number[]` (12), `.cumulative(): number[]` (12), `.quantile(q): number | null`, `.buckets`, `.sum`, `.count`

- [ ] **Step 1: Test que falla**

`tests/unit/domain/telemetry/metrics.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { HistogramValue } from "../../../../src/domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../../../src/domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../../../src/domain/telemetry/MetricCatalog.ts";
import { MetricDescriptor } from "../../../../src/domain/telemetry/MetricDescriptor.ts";
import { MetricKey } from "../../../../src/domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../../../src/domain/telemetry/MetricLabels.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("un label fuera de [A-Za-z0-9_.:-] o de más de 64 caracteres pasa a other; lo ausente es unknown", () => {
  assert.equal(LabelValue.of("kmp_ask").value, "kmp_ask");
  assert.equal(LabelValue.of("claude-opus-5.5:latest").value, "claude-opus-5.5:latest");
  assert.equal(LabelValue.of("x".repeat(64)).value, "x".repeat(64));
  assert.equal(LabelValue.of("x".repeat(65)).value, "other");
  assert.equal(LabelValue.of("a b").value, "other");
  assert.equal(LabelValue.of("/home/u/secret").value, "other");
  assert.equal(LabelValue.of("").value, "other");
  assert.equal(LabelValue.orUnknown(undefined).value, "unknown");
  assert.equal(LabelValue.orUnknown(null).value, "unknown");
  assert.equal(LabelValue.orUnknown("").value, "unknown");
  assert.equal(LabelValue.orUnknown(137).value, "137");
  assert.equal(LabelValue.orUnknown({}).value, "other");
  assert.throws(() => LabelValue.of(3 as never), DomainError);
});

test("labels canónicos ordenados por nombre y clave de estado reversible", () => {
  const labels = MetricLabels.of({ tool: LabelValue.of("kmp_ask"), status: LabelValue.of("succeeded"), server: LabelValue.of("kmp") });
  assert.equal(labels.text, "server=kmp,status=succeeded,tool=kmp_ask");
  assert.deepEqual(labels.names(), ["server", "status", "tool"]);
  assert.equal(labels.get("tool"), "kmp_ask");
  assert.equal(labels.get("nope"), null);
  const key = MetricKey.of(MetricCatalog.TOOL_INVOCATIONS, labels);
  assert.equal(key.text, "counter|pi_runtime_tool_invocations_total|server=kmp,status=succeeded,tool=kmp_ask");
  const back = MetricKey.parse(key.text)!;
  assert.equal(back.descriptor, MetricCatalog.TOOL_INVOCATIONS);
  assert.ok(back.labels.equals(labels));
  assert.equal(MetricKey.parse("hist|pi_runtime_tool_duration_ms|server=kmp,tool=kmp_ask")?.descriptor, MetricCatalog.TOOL_DURATION);
  for (const bad of ["session|session:s1", "counter|pi_runtime_nope_total|", "hist|pi_runtime_tool_invocations_total|server=kmp,status=ok,tool=t",
    "counter|pi_runtime_tool_invocations_total|tool=t", "a|b|c|d"]) assert.equal(MetricKey.parse(bad), null, bad);
  assert.throws(() => MetricKey.of(MetricCatalog.SESSIONS, MetricLabels.of({ reason: LabelValue.of("x") })), DomainError);
  assert.throws(() => MetricLabels.parse("novalue"), DomainError);
  assert.throws(() => MetricLabels.of({ "Bad-Name": LabelValue.of("x") }), DomainError);
  assert.equal(MetricLabels.parse("").text, "");
  assert.ok(MetricLabels.NONE.equals(MetricLabels.parse("")));
});

test("el catálogo es el de la spec", () => {
  assert.deepEqual(MetricCatalog.ALL.map((d) => `${d.kind} ${d.name} ${d.labelNames.join(",")}`), [
    "counter pi_runtime_tool_invocations_total server,status,tool",
    "counter pi_runtime_tool_refused_total reason,tool",
    "histogram pi_runtime_tool_duration_ms server,tool",
    "counter pi_runtime_turns_total model,outcome,provider",
    "counter pi_runtime_tokens_total kind,model,provider",
    "counter pi_runtime_cost_total model,provider",
    "counter pi_runtime_sessions_total event",
    "counter pi_runtime_compactions_total reason",
    "counter pi_runtime_server_starts_total server",
    "counter pi_runtime_server_exits_total code,server",
  ]);
  assert.equal(MetricCatalog.COST.integer, false);
  assert.equal(MetricCatalog.TURNS.integer, true);
  assert.equal(MetricCatalog.find("pi_runtime_nope_total"), null);
  assert.throws(() => MetricDescriptor.counter("pi_runtime_x", "h", []), DomainError);
  assert.throws(() => MetricDescriptor.counter("other_total", "h", []), DomainError);
  assert.throws(() => MetricDescriptor.histogram("pi_runtime_h", "h", ["le"]), DomainError);
});

test("histograma: cubos de la spec, acumulados, desbordamiento y cuantiles estimados", () => {
  let h = HistogramValue.EMPTY;
  for (const ms of [5, 10, 11, 700, 90_000]) h = h.observe(ms);
  assert.deepEqual(HistogramValue.BOUNDS, [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]);
  assert.deepEqual(h.toJson(), { buckets: [2, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], sum: 90_726, count: 5 });
  assert.deepEqual(h.bucketCounts(), [2, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(h.cumulative(), [2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5]);
  assert.equal(h.quantile(0.5), 50);
  assert.equal(h.quantile(0.95), Number.POSITIVE_INFINITY);
  assert.equal(HistogramValue.EMPTY.quantile(0.5), null);
  assert.deepEqual(HistogramValue.fromJson(h.toJson()).toJson(), h.toJson());
  for (const bad of [null, {}, { buckets: [1], sum: 0, count: 1 }, { buckets: new Array(11).fill(1), sum: 1, count: 2 }, { buckets: new Array(11).fill(0), sum: Number.NaN, count: 0 }]) {
    assert.throws(() => HistogramValue.fromJson(bad), DomainError);
  }
  assert.throws(() => h.observe(-1), DomainError);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/domain/telemetry/metrics.test.ts`
Expected: FAIL por `Cannot find module …/HistogramValue.ts`.

- [ ] **Step 3: Implementar**

`src/domain/telemetry/MetricKind.ts`:

```ts
export type MetricKind = "counter" | "histogram";
```

`src/domain/telemetry/MetricDescriptor.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { MetricKind } from "./MetricKind.ts";

const NAME = /^pi_runtime_[a-z_]+$/;
const LABEL = /^[a-z][a-z_]*$/;

// Una métrica del catálogo: nombre (el mismo en Prometheus y en OTLP), tipo, ayuda y
// nombres de label (ordenados). `integer` distingue los contadores enteros (asInt en
// OTLP) del coste, que es decimal (asDouble).
export class MetricDescriptor {
  readonly name: string; readonly kind: MetricKind; readonly help: string; readonly labelNames: readonly string[]; readonly integer: boolean;
  private constructor(name: string, kind: MetricKind, help: string, labelNames: string[], integer: boolean) {
    this.name = name; this.kind = kind; this.help = help; this.labelNames = [...labelNames].sort(); this.integer = integer;
  }

  static counter(name: string, help: string, labelNames: string[], integer = true): MetricDescriptor {
    return MetricDescriptor.#of(name, "counter", help, labelNames, integer);
  }
  static histogram(name: string, help: string, labelNames: string[]): MetricDescriptor {
    return MetricDescriptor.#of(name, "histogram", help, labelNames, false);
  }

  static #of(name: string, kind: MetricKind, help: string, labelNames: string[], integer: boolean): MetricDescriptor {
    if (!NAME.test(name)) throw DomainError.because(`invalid metric name ${name}`);
    if (kind === "counter" && !name.endsWith("_total")) throw DomainError.because(`counter ${name} must end in _total`);
    if (labelNames.some((l) => !LABEL.test(l) || l === "le")) throw DomainError.because(`invalid label names for ${name}`);
    return new MetricDescriptor(name, kind, help, labelNames, integer);
  }
}
```

`src/domain/telemetry/MetricCatalog.ts`:

```ts
import { MetricDescriptor } from "./MetricDescriptor.ts";

// Las métricas de la spec (§2). Es la única fuente: la proyección, el texto
// Prometheus, el mapeo OTLP y el test de los artefactos leen de aquí.
export class MetricCatalog {
  private constructor() {}
  static readonly TOOL_INVOCATIONS = MetricDescriptor.counter("pi_runtime_tool_invocations_total", "Tool invocations by final status.", ["tool", "server", "status"]);
  static readonly TOOL_REFUSED = MetricDescriptor.counter("pi_runtime_tool_refused_total", "Refused tool invocations by bounded reason.", ["tool", "reason"]);
  static readonly TOOL_DURATION = MetricDescriptor.histogram("pi_runtime_tool_duration_ms", "Tool invocation duration in milliseconds.", ["tool", "server"]);
  static readonly TURNS = MetricDescriptor.counter("pi_runtime_turns_total", "Completed model turns.", ["model", "provider", "outcome"]);
  static readonly TOKENS = MetricDescriptor.counter("pi_runtime_tokens_total", "Model tokens by kind.", ["model", "provider", "kind"]);
  static readonly COST = MetricDescriptor.counter("pi_runtime_cost_total", "Model cost in the unit reported by Pi.", ["model", "provider"], false);
  static readonly SESSIONS = MetricDescriptor.counter("pi_runtime_sessions_total", "Session lifecycle events.", ["event"]);
  static readonly COMPACTIONS = MetricDescriptor.counter("pi_runtime_compactions_total", "Context compactions.", ["reason"]);
  static readonly SERVER_STARTS = MetricDescriptor.counter("pi_runtime_server_starts_total", "MCP server starts.", ["server"]);
  static readonly SERVER_EXITS = MetricDescriptor.counter("pi_runtime_server_exits_total", "MCP server exits by exit code.", ["server", "code"]);

  static readonly ALL: readonly MetricDescriptor[] = [
    MetricCatalog.TOOL_INVOCATIONS, MetricCatalog.TOOL_REFUSED, MetricCatalog.TOOL_DURATION, MetricCatalog.TURNS, MetricCatalog.TOKENS,
    MetricCatalog.COST, MetricCatalog.SESSIONS, MetricCatalog.COMPACTIONS, MetricCatalog.SERVER_STARTS, MetricCatalog.SERVER_EXITS,
  ];

  static find(name: string): MetricDescriptor | null { return MetricCatalog.ALL.find((d) => d.name === name) ?? null; }
}
```

`src/domain/telemetry/LabelValue.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const SAFE = /^[A-Za-z0-9_.:-]{1,64}$/;

// Valor de label con cardinalidad acotada: lo que no cabe en [A-Za-z0-9_.:-]{1,64}
// es `other` (nunca texto libre, rutas ni mensajes de error).
export class LabelValue extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly OTHER = new LabelValue("other");
  static readonly UNKNOWN = new LabelValue("unknown");

  static of(raw: string): LabelValue {
    if (typeof raw !== "string") throw DomainError.because(`label value must be a string: ${raw}`);
    return SAFE.test(raw) ? new LabelValue(raw) : LabelValue.OTHER;
  }

  // Para payloads tolerantes: ausente o vacío es `unknown`; un entero (código de salida) se escribe como texto.
  static orUnknown(raw: unknown): LabelValue {
    if (raw === null || raw === undefined || raw === "") return LabelValue.UNKNOWN;
    if (typeof raw === "number" && Number.isInteger(raw)) return LabelValue.of(String(raw));
    return typeof raw === "string" ? LabelValue.of(raw) : LabelValue.OTHER;
  }
}
```

`src/domain/telemetry/MetricLabels.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { LabelValue } from "./LabelValue.ts";

const NAME = /^[a-z][a-z_]*$/;

// Labels canónicos: ordenados por nombre, `k=v` unidos con `,`. Como LabelValue
// nunca contiene `,` ni `=`, el texto se puede volver a leer sin ambigüedad.
export class MetricLabels {
  readonly #entries: readonly [string, LabelValue][];
  private constructor(entries: [string, LabelValue][]) { this.#entries = entries; }
  static readonly NONE = new MetricLabels([]);

  static of(values: Record<string, LabelValue>): MetricLabels {
    return new MetricLabels(Object.keys(values).sort().map((k) => {
      if (!NAME.test(k)) throw DomainError.because(`invalid label name ${k}`);
      return [k, values[k]];
    }));
  }

  static parse(text: string): MetricLabels {
    if (typeof text !== "string") throw DomainError.because("labels must be a string");
    if (text === "") return MetricLabels.NONE;
    return MetricLabels.of(Object.fromEntries(text.split(",").map((pair) => {
      const i = pair.indexOf("=");
      if (i < 1) throw DomainError.because("malformed canonical labels");
      return [pair.slice(0, i), LabelValue.of(pair.slice(i + 1))];
    })));
  }

  get text(): string { return this.#entries.map(([k, v]) => `${k}=${v.value}`).join(","); }
  entries(): [string, string][] { return this.#entries.map(([k, v]) => [k, v.value]); }
  names(): string[] { return this.#entries.map(([k]) => k); }
  get(name: string): string | null { return this.#entries.find(([k]) => k === name)?.[1].value ?? null; }
  equals(o: MetricLabels): boolean { return o.text === this.text; }
}
```

`src/domain/telemetry/MetricKey.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { MetricCatalog } from "./MetricCatalog.ts";
import type { MetricDescriptor } from "./MetricDescriptor.ts";
import { MetricLabels } from "./MetricLabels.ts";

const PREFIX = { counter: "counter", histogram: "hist" } as const;

// Clave de una serie en projection_state: `counter|<nombre>|<labels>` o `hist|<nombre>|<labels>`.
export class MetricKey {
  readonly descriptor: MetricDescriptor; readonly labels: MetricLabels;
  private constructor(descriptor: MetricDescriptor, labels: MetricLabels) { this.descriptor = descriptor; this.labels = labels; }

  static of(descriptor: MetricDescriptor, labels: MetricLabels): MetricKey {
    if (labels.names().join(",") !== descriptor.labelNames.join(",")) throw DomainError.because(`labels of ${descriptor.name} must be ${descriptor.labelNames.join(",")}`);
    return new MetricKey(descriptor, labels);
  }

  // null para las claves que no son series (el estado auxiliar de la proyección) o de métricas desconocidas.
  static parse(raw: string): MetricKey | null {
    const parts = raw.split("|");
    if (parts.length !== 3) return null;
    const descriptor = MetricCatalog.find(parts[1]);
    if (descriptor === null || PREFIX[descriptor.kind] !== parts[0]) return null;
    try { return MetricKey.of(descriptor, MetricLabels.parse(parts[2])); } catch { return null; }
  }

  get text(): string { return `${PREFIX[this.descriptor.kind]}|${this.descriptor.name}|${this.labels.text}`; }
}
```

`src/domain/telemetry/HistogramValue.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";

const BOUNDS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

// Histograma de duración con los límites fijos de la spec. `buckets[i]` cuenta las
// observaciones en (BOUNDS[i-1], BOUNDS[i]] (no acumulado); las que pasan del último
// límite sólo cuentan en `count`. Inmutable.
export class HistogramValue {
  static readonly BOUNDS: readonly number[] = BOUNDS;
  static readonly EMPTY = new HistogramValue(BOUNDS.map(() => 0), 0, 0);
  readonly buckets: readonly number[]; readonly sum: number; readonly count: number;
  private constructor(buckets: number[], sum: number, count: number) { this.buckets = buckets; this.sum = sum; this.count = count; }

  static fromJson(raw: unknown): HistogramValue {
    const o = (raw ?? {}) as { buckets?: unknown; sum?: unknown; count?: unknown };
    const buckets = Array.isArray(o.buckets) ? (o.buckets as unknown[]) : [];
    if (typeof raw !== "object" || raw === null || buckets.length !== BOUNDS.length || !buckets.every(isCount)
      || typeof o.sum !== "number" || !Number.isFinite(o.sum) || !isCount(o.count)
      || (buckets as number[]).reduce((a, b) => a + b, 0) > (o.count as number)) throw DomainError.because("invalid histogram state");
    return new HistogramValue([...(buckets as number[])], o.sum, o.count as number);
  }

  observe(ms: number): HistogramValue {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw DomainError.because(`invalid observation ${ms}`);
    const i = BOUNDS.findIndex((b) => ms <= b);
    const buckets = [...this.buckets];
    if (i >= 0) buckets[i]++;
    return new HistogramValue(buckets, this.sum + ms, this.count + 1);
  }

  toJson(): { buckets: number[]; sum: number; count: number } { return { buckets: [...this.buckets], sum: this.sum, count: this.count }; }

  // Los 12 cubos de OTLP (explicitBounds.length + 1), no acumulados; el último es el desbordamiento.
  bucketCounts(): number[] { return [...this.buckets, this.count - this.buckets.reduce((a, b) => a + b, 0)]; }

  // Acumulados por límite, como los `_bucket{le}` de Prometheus; el último (+Inf) es count.
  cumulative(): number[] { let acc = 0; return this.bucketCounts().map((n) => (acc += n)); }

  // Estimación local: el límite superior del cubo que contiene el rango q; Infinity si cae en el desbordamiento.
  quantile(q: number): number | null {
    if (this.count === 0) return null;
    const rank = Math.max(1, Math.ceil(q * this.count));
    const i = this.cumulative().findIndex((c) => c >= rank);
    return i < BOUNDS.length ? BOUNDS[i] : Number.POSITIVE_INFINITY;
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %, gates de arquitectura en verde.

- [ ] **Step 5: Commit**

```bash
git add src/domain/telemetry tests/unit/domain/telemetry
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(telemetría): catálogo de métricas, labels acotados e histograma de duración"
```

---

### Task 2: Proyección `telemetry_metrics` y su lectura

**Files:**
- Create: `src/domain/telemetry/{MetricPoint,MetricsSnapshot}.ts`, `src/application/projections/TelemetryMetricsProjection.ts`, `src/application/use-cases/ReadTelemetryMetrics.ts`
- Test: `tests/unit/application/projections/telemetry-metrics.test.ts`

**Interfaces:**
- Consumes: Task 1 (`MetricCatalog`, `LabelValue`, `MetricLabels`, `MetricKey`, `HistogramValue`); E1: `Projection`, `ProjectionState` (`get<T>`, `set`, `keys`, `accept`), `ProjectionRunner`, `EventStore.readStream`, `StoredEvent.of`, `GlobalPosition.of`.
- Produces:
  - `MetricPoint.counter(key: MetricKey, value: number)`, `MetricPoint.histogram(key, value: HistogramValue)`; campos `key`, `value: number | null`, `histogram: HistogramValue | null`
  - `MetricsSnapshot.of(points: MetricPoint[])`, `.points()`, `.isEmpty()`, `.byDescriptor(): { descriptor: MetricDescriptor; points: MetricPoint[] }[]` (orden del catálogo, sólo métricas con series)
  - `TelemetryMetricsProjection.NAME` (`telemetry_metrics`), `TelemetryMetricsProjection.VERSION` (1)
  - `new ReadTelemetryMetrics(events: EventStore, store: ProjectionStore)`, `.execute(session?: SessionId): MetricsSnapshot` (con `session`, reproduce sólo ese stream en memoria)

- [ ] **Step 1: Test que falla**

`tests/unit/application/projections/telemetry-metrics.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import type { ProjectionStore } from "../../../../src/application/ports/ProjectionStore.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { ReadTelemetryMetrics } from "../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import type { MetricsSnapshot } from "../../../../src/domain/telemetry/MetricsSnapshot.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const S2 = StreamId.session(SessionId.of("s2"));

function world(events: EventStore): void {
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o1", { reason: "startup" }),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 40, status: "succeeded" }),
    fact("tool.completed", "c2", { tool: "kmp_ingest", server: "kmp", callId: "c2", durationMs: 700, status: "refused", errorCode: "invalid_argument" }),
    fact("tool.completed", "c3", { tool: "bash", server: "pi", callId: "c3", status: "failed", errorKind: "tool_error" }),
    fact("tool.completed", "c4", { tool: "weird tool/../x", server: "pi", callId: "c4", durationMs: 90_000, status: "exploded" }),
    fact("turn.completed", "t1", { model: "m1", provider: "p1", tokens: { input: 10, output: 4, cacheRead: 6, cacheWrite: 1 }, cost: 0.25, outcome: "completed" }),
    fact("turn.completed", "t2", { model: "m1", provider: "p1", tokens: { input: 2 }, cost: 0.5, outcome: "error" }),
    fact("context.compacted", "k1", { tokensBefore: 100, tokensAfter: 10, reason: "threshold" }),
    fact("session.closed", "x1", { reason: "quit" }),
    fact("session.opened", "o2", { reason: "resume" }),
  ], AT);
  events.append(S2, StreamVersion.NONE, [fact("session.opened", "o", { reason: "startup" }, S2)], AT);
  events.append(StreamId.HOST, StreamVersion.NONE, [
    fact("host.started", "h1", { version: "0.1.0", pid: 1 }, StreamId.HOST),
    fact("server.started", "k1", { server: "kmp", name: "kmp", version: "1.0.0" }, StreamId.HOST),
    fact("server.exited", "k2", { server: "kmp", code: 137 }, StreamId.HOST),
    fact("server.exited", "k3", { server: "made", code: null }, StreamId.HOST),
  ], AT);
}

const flat = (s: MetricsSnapshot) => Object.fromEntries(s.points().map((p) => [`${p.key.descriptor.name}{${p.key.labels.text}}`, p.histogram ? p.histogram.toJson() : p.value]));
const zeros = (i: number) => { const b = new Array(11).fill(0); if (i >= 0) b[i] = 1; return b; };

const EXPECTED = {
  "pi_runtime_tool_invocations_total{server=kmp,status=succeeded,tool=kmp_ask}": 1,
  "pi_runtime_tool_invocations_total{server=kmp,status=refused,tool=kmp_ingest}": 1,
  "pi_runtime_tool_invocations_total{server=pi,status=failed,tool=bash}": 1,
  "pi_runtime_tool_invocations_total{server=pi,status=unknown,tool=other}": 1,
  "pi_runtime_tool_refused_total{reason=invalid_argument,tool=kmp_ingest}": 1,
  "pi_runtime_tool_duration_ms{server=kmp,tool=kmp_ask}": { buckets: zeros(1), sum: 40, count: 1 },
  "pi_runtime_tool_duration_ms{server=kmp,tool=kmp_ingest}": { buckets: zeros(5), sum: 700, count: 1 },
  "pi_runtime_tool_duration_ms{server=pi,tool=other}": { buckets: zeros(-1), sum: 90_000, count: 1 },
  "pi_runtime_turns_total{model=m1,outcome=completed,provider=p1}": 1,
  "pi_runtime_turns_total{model=m1,outcome=error,provider=p1}": 1,
  "pi_runtime_tokens_total{kind=input,model=m1,provider=p1}": 12,
  "pi_runtime_tokens_total{kind=output,model=m1,provider=p1}": 4,
  "pi_runtime_tokens_total{kind=cache_read,model=m1,provider=p1}": 6,
  "pi_runtime_tokens_total{kind=cache_write,model=m1,provider=p1}": 1,
  "pi_runtime_cost_total{model=m1,provider=p1}": 0.75,
  "pi_runtime_sessions_total{event=opened}": 2,
  "pi_runtime_sessions_total{event=closed}": 1,
  "pi_runtime_sessions_total{event=reopened}": 1,
  "pi_runtime_compactions_total{reason=threshold}": 1,
  "pi_runtime_server_starts_total{server=kmp}": 1,
  "pi_runtime_server_exits_total{code=137,server=kmp}": 1,
  "pi_runtime_server_exits_total{code=unknown,server=made}": 1,
};

const BACKENDS: [string, () => { events: EventStore; store: ProjectionStore }][] = [
  ["memoria", () => ({ events: new InMemoryEventStore(), store: new InMemoryProjectionStore() })],
  ["sqlite", () => { const db = SqliteDatabase.open(":memory:"); return { events: new SqliteEventStore(db), store: new SqliteProjectionStore(db) }; }],
];

for (const [label, open] of BACKENDS) {
  test(`${label}: contadores e histograma acumulados con labels acotados`, () => {
    const { events, store } = open();
    world(events);
    new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
    assert.deepEqual(flat(new ReadTelemetryMetrics(events, store).execute()), EXPECTED);
    assert.deepEqual(store.quarantined(TelemetryMetricsProjection.NAME), []);
  });

  test(`${label}: --session reproduce sólo el stream de esa sesión`, () => {
    const { events, store } = open();
    world(events);
    const read = new ReadTelemetryMetrics(events, store);
    assert.deepEqual(flat(read.execute(SessionId.of("s2"))), { "pi_runtime_sessions_total{event=opened}": 1 });
    const s1 = flat(read.execute(SessionId.of("s1")));
    assert.equal(s1["pi_runtime_sessions_total{event=reopened}"], 1);
    assert.equal(s1["pi_runtime_server_starts_total{server=kmp}"], undefined);
    assert.ok(read.execute(SessionId.of("nadie")).isEmpty());
  });
}

test("incremental y reconstrucción dan lo mismo; el orden del snapshot sigue al catálogo", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new TelemetryMetricsProjection()], 2);
  world(events);
  runner.runOnce();
  const incremental = flat(new ReadTelemetryMetrics(events, store).execute());
  runner.rebuild(TelemetryMetricsProjection.NAME);
  assert.deepEqual(flat(new ReadTelemetryMetrics(events, store).execute()), incremental);
  const groups = new ReadTelemetryMetrics(events, store).execute().byDescriptor().map((g) => g.descriptor.name);
  assert.deepEqual(groups, ["pi_runtime_tool_invocations_total", "pi_runtime_tool_refused_total", "pi_runtime_tool_duration_ms", "pi_runtime_turns_total",
    "pi_runtime_tokens_total", "pi_runtime_cost_total", "pi_runtime_sessions_total", "pi_runtime_compactions_total", "pi_runtime_server_starts_total", "pi_runtime_server_exits_total"]);
});

test("payloads inesperados cuentan como dato ausente, sin cuarentena", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o"),
    fact("turn.completed", "t", { tokens: "nope", cost: "free", model: { x: 1 } }),
    fact("tool.completed", "c", { durationMs: -5, status: 3 }),
  ], AT);
  new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
  const m = flat(new ReadTelemetryMetrics(events, store).execute());
  assert.equal(m["pi_runtime_turns_total{model=other,outcome=unknown,provider=unknown}"], 1);
  assert.equal(m["pi_runtime_tokens_total{kind=input,model=other,provider=unknown}"], 0);
  assert.equal(m["pi_runtime_cost_total{model=other,provider=unknown}"], 0);
  assert.equal(m["pi_runtime_tool_invocations_total{server=unknown,status=unknown,tool=unknown}"], 1);
  assert.equal(Object.keys(m).some((k) => k.startsWith("pi_runtime_tool_duration_ms")), false);
  assert.deepEqual(store.quarantined(TelemetryMetricsProjection.NAME), []);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/projections/telemetry-metrics.test.ts`
Expected: FAIL por `Cannot find module …/TelemetryMetricsProjection.ts`.

- [ ] **Step 3: Implementar**

`src/domain/telemetry/MetricPoint.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { HistogramValue } from "./HistogramValue.ts";
import type { MetricKey } from "./MetricKey.ts";

// Una serie con su valor acumulado: un número (contador) o un histograma.
export class MetricPoint {
  readonly key: MetricKey; readonly value: number | null; readonly histogram: HistogramValue | null;
  private constructor(key: MetricKey, value: number | null, histogram: HistogramValue | null) { this.key = key; this.value = value; this.histogram = histogram; }

  static counter(key: MetricKey, value: number): MetricPoint {
    if (key.descriptor.kind !== "counter" || typeof value !== "number" || !Number.isFinite(value) || value < 0) throw DomainError.because(`invalid counter value for ${key.text}`);
    return new MetricPoint(key, value, null);
  }
  static histogram(key: MetricKey, value: HistogramValue): MetricPoint {
    if (key.descriptor.kind !== "histogram") throw DomainError.because(`${key.descriptor.name} is not a histogram`);
    return new MetricPoint(key, null, value);
  }
}
```

`src/domain/telemetry/MetricsSnapshot.ts`:

```ts
import { MetricCatalog } from "./MetricCatalog.ts";
import type { MetricDescriptor } from "./MetricDescriptor.ts";
import type { MetricPoint } from "./MetricPoint.ts";

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Todas las series acumuladas en un instante, en orden estable: catálogo y labels canónicos.
export class MetricsSnapshot {
  readonly #points: readonly MetricPoint[];
  private constructor(points: MetricPoint[]) { this.#points = points; }

  static of(points: MetricPoint[]): MetricsSnapshot {
    const order = (p: MetricPoint) => MetricCatalog.ALL.indexOf(p.key.descriptor);
    return new MetricsSnapshot([...points].sort((a, b) => order(a) - order(b) || byText(a.key.labels.text, b.key.labels.text)));
  }

  points(): MetricPoint[] { return [...this.#points]; }
  isEmpty(): boolean { return this.#points.length === 0; }
  byDescriptor(): { descriptor: MetricDescriptor; points: MetricPoint[] }[] {
    return MetricCatalog.ALL.map((descriptor) => ({ descriptor, points: this.#points.filter((p) => p.key.descriptor === descriptor) })).filter((g) => g.points.length > 0);
  }
}
```

`src/application/projections/TelemetryMetricsProjection.ts`:

```ts
import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import { HistogramValue } from "../../domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../domain/telemetry/MetricCatalog.ts";
import type { MetricDescriptor } from "../../domain/telemetry/MetricDescriptor.ts";
import { MetricKey } from "../../domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../domain/telemetry/MetricLabels.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const STATUSES = ["succeeded", "failed", "refused", "aborted"];
const TOKEN_KINDS: [string, string][] = [["input", "input"], ["output", "output"], ["cache_read", "cacheRead"], ["cache_write", "cacheWrite"]];
const L = (v: unknown) => LabelValue.orUnknown(v);

// Contadores acumulados e histograma de duración (spec §2). Tolerante: un payload
// inesperado cuenta como dato ausente (`unknown`, 0 o sin observación); sólo un error
// de programación llega a la cuarentena de E1. `session|<stream>` es estado auxiliar
// (abierta o cerrada) para distinguir `opened` de `reopened`.
export class TelemetryMetricsProjection implements Projection {
  static readonly NAME = ProjectionName.of("telemetry_metrics");
  static readonly VERSION = 1;
  readonly name = TelemetryMetricsProjection.NAME;
  readonly version = TelemetryMetricsProjection.VERSION;

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record; const p = obj(r.payload.toValue());
    switch (r.type.value) {
      case "tool.completed": {
        const tool = L(p.tool); const server = L(p.server);
        const status = typeof p.status === "string" && STATUSES.includes(p.status) ? LabelValue.of(p.status) : LabelValue.UNKNOWN;
        this.#add(state, MetricCatalog.TOOL_INVOCATIONS, { tool, server, status }, 1);
        if (status.value === "refused") this.#add(state, MetricCatalog.TOOL_REFUSED, { tool, reason: L(p.errorCode) }, 1);
        const duration = num(p.durationMs);
        if (duration !== null && duration >= 0) this.#observe(state, MetricCatalog.TOOL_DURATION, { tool, server }, duration);
        break;
      }
      case "turn.completed": {
        const model = L(p.model); const provider = L(p.provider); const tokens = obj(p.tokens);
        this.#add(state, MetricCatalog.TURNS, { model, provider, outcome: L(p.outcome) }, 1);
        for (const [kind, field] of TOKEN_KINDS) this.#add(state, MetricCatalog.TOKENS, { model, provider, kind: LabelValue.of(kind) }, num(tokens[field]) ?? 0);
        this.#add(state, MetricCatalog.COST, { model, provider }, num(p.cost) ?? 0);
        break;
      }
      case "session.opened": {
        const key = `session|${r.stream.value}`;
        const seen = state.get<string>(key) !== undefined;
        state.set(key, "open");
        this.#add(state, MetricCatalog.SESSIONS, { event: LabelValue.of(seen ? "reopened" : "opened") }, 1);
        break;
      }
      case "session.closed":
        state.set(`session|${r.stream.value}`, "closed");
        this.#add(state, MetricCatalog.SESSIONS, { event: LabelValue.of("closed") }, 1);
        break;
      case "context.compacted": this.#add(state, MetricCatalog.COMPACTIONS, { reason: L(p.reason) }, 1); break;
      case "server.started": this.#add(state, MetricCatalog.SERVER_STARTS, { server: L(p.server) }, 1); break;
      case "server.exited": this.#add(state, MetricCatalog.SERVER_EXITS, { server: L(p.server), code: L(p.code) }, 1); break;
    }
  }

  // Un incremento negativo nunca entra: los contadores sólo crecen.
  #add(state: ProjectionState, d: MetricDescriptor, labels: Record<string, LabelValue>, by: number): void {
    const key = MetricKey.of(d, MetricLabels.of(labels)).text;
    state.set(key, (state.get<number>(key) ?? 0) + Math.max(0, by));
  }

  #observe(state: ProjectionState, d: MetricDescriptor, labels: Record<string, LabelValue>, ms: number): void {
    const key = MetricKey.of(d, MetricLabels.of(labels)).text;
    const current = state.get<unknown>(key);
    state.set(key, (current === undefined ? HistogramValue.EMPTY : HistogramValue.fromJson(current)).observe(ms).toJson());
  }
}
```

`src/application/use-cases/ReadTelemetryMetrics.ts`:

```ts
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StoredEvent } from "../../domain/events/StoredEvent.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { HistogramValue } from "../../domain/telemetry/HistogramValue.ts";
import { MetricKey } from "../../domain/telemetry/MetricKey.ts";
import { MetricPoint } from "../../domain/telemetry/MetricPoint.ts";
import { MetricsSnapshot } from "../../domain/telemetry/MetricsSnapshot.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";
import { ProjectionState } from "../services/ProjectionState.ts";

// Snapshot de las métricas acumuladas. Sin sesión, del estado de `telemetry_metrics`;
// con sesión, reproduciendo en memoria sólo su stream (las métricas no llevan label de
// sesión: así no crece la cardinalidad).
export class ReadTelemetryMetrics {
  readonly #events: EventStore; readonly #store: ProjectionStore;
  constructor(events: EventStore, store: ProjectionStore) { this.#events = events; this.#store = store; }

  execute(session?: SessionId): MetricsSnapshot {
    const state = session === undefined ? this.#store.load(TelemetryMetricsProjection.NAME) : this.#replay(session);
    const points: MetricPoint[] = [];
    for (const [raw, value] of state) {
      const key = MetricKey.parse(raw);
      if (key === null) continue;
      points.push(key.descriptor.kind === "histogram" ? MetricPoint.histogram(key, HistogramValue.fromJson(value)) : MetricPoint.counter(key, Number(value)));
    }
    return MetricsSnapshot.of(points);
  }

  #replay(session: SessionId): Map<string, unknown> {
    const projection = new TelemetryMetricsProjection(); const state = new ProjectionState(new Map());
    this.#events.readStream(StreamId.session(session)).forEach((r, i) => { projection.apply(state, StoredEvent.of(GlobalPosition.of(i + 1), r)); state.accept(); });
    return new Map(state.keys().map((k) => [k, state.get<unknown>(k)]));
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/application/projections/telemetry-metrics.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(telemetría): proyección telemetry_metrics y lectura del snapshot acumulado"
```

---

### Task 3: Proyección `quality_kpis` y su informe

**Files:**
- Create: `src/application/dto/{KpiTallyDto,QualityKpisDto}.ts`, `src/application/projections/QualityKpisProjection.ts`, `src/application/use-cases/QualityKpisReport.ts`
- Test: `tests/unit/application/projections/quality-kpis.test.ts`

**Interfaces:**
- Consumes: E1 `Projection`, `ProjectionState`, `ProjectionStore.load`.
- Produces:
  - `type KpiTallyDto = { sessions; turns; cost; tokens: { input; output; cacheRead; cacheWrite }; invocations; refused; firstTryAttempted; firstTrySucceeded; compactions }` (todo `number`)
  - `type QualityKpisDto = { scope: string; sessions; turns; cost; tokens: {…}; invocations; firstTrySuccess: number | null; refusalRate: number | null; cacheRatio: number | null; compactions; compactionsPerSession: number | null }`
  - `QualityKpisProjection.NAME` (`quality_kpis`), `.VERSION` (1), `QualityKpisProjection.emptyTally(): KpiTallyDto`; estado `global` y `session:<id>` → `KpiTallyDto`, `turn:<id>` → `string[]`
  - `new QualityKpisReport(store: ProjectionStore)`, `.execute(session?: SessionId): QualityKpisDto | null` (global nunca es null), `QualityKpisReport.toDto(scope, tally)`

- [ ] **Step 1: Test que falla**

`tests/unit/application/projections/quality-kpis.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import type { ProjectionStore } from "../../../../src/application/ports/ProjectionStore.ts";
import { QualityKpisProjection } from "../../../../src/application/projections/QualityKpisProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { QualityKpisReport } from "../../../../src/application/use-cases/QualityKpisReport.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const S2 = StreamId.session(SessionId.of("s2"));
const tool = (about: string, name: string, status: string) => fact("tool.completed", about, { tool: name, server: "kmp", callId: about, status });

function world(events: EventStore): void {
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", { reason: "startup" }),
    tool("a1", "kmp_ask", "failed"),
    tool("a2", "kmp_ask", "succeeded"),
    tool("a3", "kmp_search", "succeeded"),
    fact("turn.completed", "t1", { tokens: { input: 10, output: 5, cacheRead: 30, cacheWrite: 0 }, cost: 0.25 }),
    tool("b1", "kmp_ask", "succeeded"),
    tool("b2", "bash", "refused"),
    fact("turn.completed", "t2", { tokens: { input: 5, output: 1, cacheRead: 5 }, cost: 0.5 }),
    fact("context.compacted", "k", { reason: "threshold" }),
    fact("session.closed", "x", { reason: "quit" }),
    fact("session.opened", "o2", { reason: "resume" }),
  ], AT);
  events.append(S2, StreamVersion.NONE, [
    fact("session.opened", "o", {}, S2),
    fact("tool.completed", "c", { tool: "x", server: "pi", callId: "c", status: "succeeded" }, S2),
    fact("turn.completed", "t", { tokens: { input: 10, output: 3 }, cost: 0.25 }, S2),
  ], AT);
  events.append(StreamId.HOST, StreamVersion.NONE, [fact("host.started", "h", {}, StreamId.HOST)], AT);
}

const BACKENDS: [string, () => { events: EventStore; store: ProjectionStore }][] = [
  ["memoria", () => ({ events: new InMemoryEventStore(), store: new InMemoryProjectionStore() })],
  ["sqlite", () => { const db = SqliteDatabase.open(":memory:"); return { events: new SqliteEventStore(db), store: new SqliteProjectionStore(db) }; }],
];

for (const [label, open] of BACKENDS) {
  test(`${label}: KPIs por sesión (éxito a la primera por turno, negativas, caché, compactaciones)`, () => {
    const { events, store } = open();
    world(events);
    new ProjectionRunner(events, store, [new QualityKpisProjection()]).runOnce();
    const s1 = new QualityKpisReport(store).execute(SessionId.of("s1"))!;
    assert.deepEqual(s1, { scope: "s1", sessions: 1, turns: 2, cost: 0.75, tokens: { input: 15, output: 6, cacheRead: 35, cacheWrite: 0 }, invocations: 5,
      firstTrySuccess: 0.5, refusalRate: 0.2, cacheRatio: 35 / 50, compactions: 1, compactionsPerSession: 1 });
    assert.equal(new QualityKpisReport(store).execute(SessionId.of("nadie")), null);
  });

  test(`${label}: KPIs globales; la reapertura no cuenta otra sesión`, () => {
    const { events, store } = open();
    world(events);
    new ProjectionRunner(events, store, [new QualityKpisProjection()]).runOnce();
    const g = new QualityKpisReport(store).execute()!;
    assert.deepEqual(g, { scope: "global", sessions: 2, turns: 3, cost: 1, tokens: { input: 25, output: 9, cacheRead: 35, cacheWrite: 0 }, invocations: 6,
      firstTrySuccess: 3 / 5, refusalRate: 1 / 6, cacheRatio: 35 / 60, compactions: 1, compactionsPerSession: 0.5 });
  });
}

test("sin datos: global con ratios null y ceros", () => {
  const g = new QualityKpisReport(new InMemoryProjectionStore()).execute()!;
  assert.deepEqual(g, { scope: "global", sessions: 0, turns: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, invocations: 0,
    firstTrySuccess: null, refusalRate: null, cacheRatio: null, compactions: 0, compactionsPerSession: null });
});

test("payloads inesperados cuentan como ausentes; el set de tools del turno está acotado", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o"),
    fact("turn.completed", "t", { tokens: "nope", cost: "gratis" }),
    fact("tool.completed", "c", { status: 1 }),
    ...Array.from({ length: 300 }, (_, i) => fact("tool.completed", `m${i}`, { tool: `t${i}`, status: "succeeded" })),
  ], AT);
  new ProjectionRunner(events, store, [new QualityKpisProjection()]).runOnce();
  const s = new QualityKpisReport(store).execute(SessionId.of("s1"))!;
  assert.deepEqual([s.turns, s.cost, s.tokens.input, s.invocations], [1, 0, 0, 301]);
  assert.ok((store.load(QualityKpisProjection.NAME).get("turn:s1") as string[]).length <= 256);
  assert.deepEqual(store.quarantined(QualityKpisProjection.NAME), []);
});
```

(En s1: turno 1 — `kmp_ask` falla a la primera y `kmp_search` acierta; turno 2 — `kmp_ask` acierta y `bash` sale `refused`: 2 de 4 primeras invocaciones. En global se suma la de s2: 3 de 5.)

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/projections/quality-kpis.test.ts`
Expected: FAIL por `Cannot find module …/QualityKpisProjection.ts`.

- [ ] **Step 3: Implementar**

`src/application/dto/KpiTallyDto.ts`:

```ts
export type KpiTallyDto = {
  sessions: number;
  turns: number;
  cost: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  invocations: number;
  refused: number;
  firstTryAttempted: number;
  firstTrySucceeded: number;
  compactions: number;
};
```

`src/application/dto/QualityKpisDto.ts`:

```ts
// Ratios null cuando el denominador es 0 (no hay datos, no es un 0 %).
export type QualityKpisDto = {
  scope: string;
  sessions: number;
  turns: number;
  cost: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  invocations: number;
  firstTrySuccess: number | null;
  refusalRate: number | null;
  cacheRatio: number | null;
  compactions: number;
  compactionsPerSession: number | null;
};
```

`src/application/projections/QualityKpisProjection.ts`:

```ts
import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import type { KpiTallyDto } from "../dto/KpiTallyDto.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const MAX_TURN_TOOLS = 256;

// KPIs de calidad (spec §3), globales (`global`) y por sesión (`session:<id>`).
// Éxito a la primera: de cada tool, sólo su primera invocación dentro del turno
// cuenta, y acierta si sale `succeeded`. `turn:<id>` guarda las tools ya vistas en el
// turno en curso; `turn.completed` (que Pi emite tras ejecutar las tools del turno),
// la apertura y el cierre lo vacían.
export class QualityKpisProjection implements Projection {
  static readonly NAME = ProjectionName.of("quality_kpis");
  static readonly VERSION = 1;
  readonly name = QualityKpisProjection.NAME;
  readonly version = QualityKpisProjection.VERSION;

  static emptyTally(): KpiTallyDto {
    return { sessions: 0, turns: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, invocations: 0, refused: 0, firstTryAttempted: 0, firstTrySucceeded: 0, compactions: 0 };
  }

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record;
    if (!r.stream.isSession()) return;
    const sid = r.stream.sessionId().value; const p = obj(r.payload.toValue());
    const sessionKey = `session:${sid}`; const turnKey = `turn:${sid}`;
    const edit = (fn: (t: KpiTallyDto) => void) => {
      for (const key of ["global", sessionKey]) { const t = state.get<KpiTallyDto>(key) ?? QualityKpisProjection.emptyTally(); fn(t); state.set(key, t); }
    };
    switch (r.type.value) {
      case "session.opened":
        if (state.get<KpiTallyDto>(sessionKey) === undefined) edit((t) => { t.sessions++; });
        state.set(turnKey, []);
        break;
      case "turn.completed": {
        const tokens = obj(p.tokens);
        edit((t) => {
          t.turns++; t.cost += n(p.cost);
          t.tokens = { input: t.tokens.input + n(tokens.input), output: t.tokens.output + n(tokens.output), cacheRead: t.tokens.cacheRead + n(tokens.cacheRead), cacheWrite: t.tokens.cacheWrite + n(tokens.cacheWrite) };
        });
        state.set(turnKey, []);
        break;
      }
      case "tool.completed": {
        const tool = typeof p.tool === "string" ? p.tool : "unknown";
        const seen = state.get<string[]>(turnKey) ?? [];
        const first = !seen.includes(tool);
        edit((t) => {
          t.invocations++;
          if (p.status === "refused") t.refused++;
          if (first) { t.firstTryAttempted++; if (p.status === "succeeded") t.firstTrySucceeded++; }
        });
        if (first && seen.length < MAX_TURN_TOOLS) state.set(turnKey, [...seen, tool]);
        break;
      }
      case "context.compacted": edit((t) => { t.compactions++; }); break;
      case "session.closed": state.set(turnKey, []); break;
    }
  }
}
```

`src/application/use-cases/QualityKpisReport.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import type { KpiTallyDto } from "../dto/KpiTallyDto.ts";
import type { QualityKpisDto } from "../dto/QualityKpisDto.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { QualityKpisProjection } from "../projections/QualityKpisProjection.ts";

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export class QualityKpisReport {
  readonly #store: ProjectionStore;
  constructor(store: ProjectionStore) { this.#store = store; }

  // Global siempre responde (a ceros si no hay datos); una sesión desconocida es null.
  execute(session?: SessionId): QualityKpisDto | null {
    const key = session === undefined ? "global" : `session:${session.value}`;
    const tally = this.#store.load(QualityKpisProjection.NAME).get(key) as KpiTallyDto | undefined;
    if (tally === undefined) return session === undefined ? QualityKpisReport.toDto("global", QualityKpisProjection.emptyTally()) : null;
    return QualityKpisReport.toDto(session?.value ?? "global", tally);
  }

  static toDto(scope: string, t: KpiTallyDto): QualityKpisDto {
    return {
      scope, sessions: t.sessions, turns: t.turns, cost: t.cost, tokens: { ...t.tokens }, invocations: t.invocations,
      firstTrySuccess: ratio(t.firstTrySucceeded, t.firstTryAttempted), refusalRate: ratio(t.refused, t.invocations),
      cacheRatio: ratio(t.tokens.cacheRead, t.tokens.input + t.tokens.cacheRead), compactions: t.compactions, compactionsPerSession: ratio(t.compactions, t.sessions),
    };
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/application/projections/quality-kpis.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(telemetría): proyección quality_kpis e informe global y por sesión"
```

---

### Task 4: Modelo de spans e ids deterministas

**Files:**
- Create: `src/domain/telemetry/{TelemetryDigest,TraceId,SpanId,SpanStatus,SpanAttributes,SpanEvent,SpanJson,Span}.ts`
- Test: `tests/unit/domain/telemetry/spans.test.ts`

**Interfaces:**
- Consumes: E1 `StreamId`, `EventId`, `Timestamp` (`fromEpochMs`, `epochMs`, `.value`).
- Produces:
  - `TelemetryDigest.hex(domain: string, ...parts: string[]): string` (sha256 hex con encuadre `"<bytes>:<valor>"`)
  - `TraceId.of(hex32)`, `TraceId.forStream(stream: StreamId)`, `TraceId.forHostRun(started: EventId)`
  - `SpanId.of(hex16)`, `SpanId.forEvent(id: EventId)`
  - `SpanStatus.UNSET`, `SpanStatus.ERROR`, `SpanStatus.of(raw)`, `.isError()`
  - `SpanAttributes.of(values: Record<string, string | number | boolean | null | undefined>)`, `SpanAttributes.NONE`, `.get(key)`, `.entries()`, `.toRecord()`
  - `SpanEvent.of(name, at: Timestamp, attributes)` (nombres: `phase.changed`, `model.selected`, `context.compacted`)
  - `type SpanJson = { traceId; spanId; parentId: string | null; name; startMs; endMs; status; attributes: Record<string, string | number | boolean>; events: { name; atMs; attributes }[] }`
  - `Span.of({ traceId, spanId, parentId, name, start, end, status, attributes, events })` (nombres: `session`, `turn`, `tool`, `host`, `mcp_server`), `.durationMs()`, `.toJson(): SpanJson`, `Span.fromJson(json)`

- [ ] **Step 1: Test que falla**

`tests/unit/domain/telemetry/spans.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { Span } from "../../../../src/domain/telemetry/Span.ts";
import { SpanAttributes } from "../../../../src/domain/telemetry/SpanAttributes.ts";
import { SpanEvent } from "../../../../src/domain/telemetry/SpanEvent.ts";
import { SpanId } from "../../../../src/domain/telemetry/SpanId.ts";
import { SpanStatus } from "../../../../src/domain/telemetry/SpanStatus.ts";
import { TelemetryDigest } from "../../../../src/domain/telemetry/TelemetryDigest.ts";
import { TraceId } from "../../../../src/domain/telemetry/TraceId.ts";
import { SESSION } from "../../../support/recordFixtures.ts";

const framed = (...parts: string[]) => createHash("sha256").update(parts.map((p) => `${Buffer.byteLength(p)}:${p}`).join("")).digest("hex");

test("ids deterministas: traza por stream (host: por arranque) y span por el event_id que lo abre", () => {
  assert.equal(TraceId.forStream(SESSION).value, framed("pi-runtime.trace", "session:s1").slice(0, 32));
  const started = EventId.of("host:host.started:42.1000.0");
  assert.equal(TraceId.forHostRun(started).value, framed("pi-runtime.trace", "host", started.value).slice(0, 32));
  assert.notEqual(TraceId.forHostRun(started).value, TraceId.forStream(StreamId.HOST).value);
  const opened = EventId.of("session:s1:session.opened:opened.1000");
  assert.equal(SpanId.forEvent(opened).value, framed("pi-runtime.span", opened.value).slice(0, 16));
  assert.ok(SpanId.forEvent(opened).equals(SpanId.forEvent(EventId.of(opened.value))));
  assert.equal(TelemetryDigest.hex("d", "a", "bc"), framed("d", "a", "bc"));
  assert.notEqual(TelemetryDigest.hex("d", "ab", "c"), TelemetryDigest.hex("d", "a", "bc"), "el encuadre evita ambigüedades");
  for (const bad of ["", "0".repeat(32), "A".repeat(32), "abc"]) assert.throws(() => TraceId.of(bad), DomainError);
  for (const bad of ["", "0".repeat(16), "xyz"]) assert.throws(() => SpanId.of(bad), DomainError);
  assert.throws(() => TraceId.of(undefined as never), DomainError);
  assert.throws(() => SpanId.of(undefined as never), DomainError);
});

test("atributos: ordenados, sin nulos ni no finitos, textos recortados y claves validadas", () => {
  const a = SpanAttributes.of({ "pi_runtime.tool": "kmp_ask", "a.b": 1, skip: null, gone: undefined, nan: Number.NaN, flag: true, long: "x".repeat(300) });
  assert.deepEqual(a.entries().map(([k]) => k), ["a.b", "flag", "long", "pi_runtime.tool"]);
  assert.equal((a.get("long") as string).length, 256);
  assert.equal(a.get("nope"), null);
  assert.deepEqual(SpanAttributes.NONE.toRecord(), {});
  assert.throws(() => SpanAttributes.of({ "Bad Key": 1 }), DomainError);
  assert.throws(() => SpanAttributes.of({ k: {} as never }), DomainError);
});

test("span: fin nunca anterior al inicio, JSON reversible y nombres cerrados", () => {
  const t = TraceId.forStream(SESSION); const id = SpanId.forEvent(EventId.of("e1"));
  const s = Span.of({ traceId: t, spanId: id, parentId: null, name: "session", start: Timestamp.fromEpochMs(2000), end: Timestamp.fromEpochMs(1000), status: SpanStatus.UNSET,
    attributes: SpanAttributes.of({ "pi_runtime.reopened": true }), events: [SpanEvent.of("phase.changed", Timestamp.fromEpochMs(1500), SpanAttributes.of({ "pi_runtime.phase.to": "design" }))] });
  assert.equal(s.durationMs(), 0);
  const json = s.toJson();
  assert.deepEqual(json, { traceId: t.value, spanId: id.value, parentId: null, name: "session", startMs: 2000, endMs: 2000, status: "unset",
    attributes: { "pi_runtime.reopened": true }, events: [{ name: "phase.changed", atMs: 1500, attributes: { "pi_runtime.phase.to": "design" } }] });
  assert.deepEqual(Span.fromJson(json).toJson(), json);
  const child = Span.fromJson({ ...json, name: "tool", parentId: id.value, status: "error", events: [] });
  assert.ok(child.parentId?.equals(id));
  assert.ok(child.status.isError());
  assert.equal(SpanStatus.UNSET.isError(), false);
  assert.throws(() => Span.fromJson({ ...json, name: "prompt" }), DomainError);
  assert.throws(() => SpanEvent.of("tool.started", Timestamp.fromEpochMs(0), SpanAttributes.NONE), DomainError);
  assert.throws(() => SpanStatus.of("ok"), DomainError);
  assert.ok(SpanStatus.of("unset").equals(SpanStatus.UNSET));
  assert.ok(SpanStatus.of("error").equals(SpanStatus.ERROR));
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/domain/telemetry/spans.test.ts`
Expected: FAIL por `Cannot find module …/Span.ts`.

- [ ] **Step 3: Implementar**

`src/domain/telemetry/TelemetryDigest.ts`:

```ts
import { createHash } from "node:crypto";

const utf8 = new TextEncoder();

// sha256 con el mismo encuadre que la cadena de E1: cada parte como
// "<bytesUtf8>:<valor>", así ninguna concatenación es ambigua ("ab"+"c" ≠ "a"+"bc").
export class TelemetryDigest {
  private constructor() {}
  static hex(domain: string, ...parts: string[]): string {
    const hash = createHash("sha256");
    for (const part of [domain, ...parts]) hash.update(`${utf8.encode(part).length}:${part}`);
    return hash.digest("hex");
  }
}
```

`src/domain/telemetry/TraceId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { EventId } from "../events/EventId.ts";
import { StreamId } from "../events/StreamId.ts";
import { TelemetryDigest } from "./TelemetryDigest.ts";

// 16 bytes en hex. Una sesión es una traza (su stream); el host, una traza por arranque.
export class TraceId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): TraceId {
    if (typeof raw !== "string" || !/^[0-9a-f]{32}$/.test(raw) || /^0+$/.test(raw)) throw DomainError.because("trace id must be 32 lowercase hex characters, not all zero");
    return new TraceId(raw);
  }
  static forStream(stream: StreamId): TraceId { return TraceId.of(TelemetryDigest.hex("pi-runtime.trace", stream.value).slice(0, 32)); }
  static forHostRun(started: EventId): TraceId { return TraceId.of(TelemetryDigest.hex("pi-runtime.trace", StreamId.HOST.value, started.value).slice(0, 32)); }
}
```

`src/domain/telemetry/SpanId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { EventId } from "../events/EventId.ts";
import { TelemetryDigest } from "./TelemetryDigest.ts";

// 8 bytes en hex, derivados del event_id del hecho que abre el span: reexportar da los mismos ids.
export class SpanId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): SpanId {
    if (typeof raw !== "string" || !/^[0-9a-f]{16}$/.test(raw) || /^0+$/.test(raw)) throw DomainError.because("span id must be 16 lowercase hex characters, not all zero");
    return new SpanId(raw);
  }
  static forEvent(id: EventId): SpanId { return SpanId.of(TelemetryDigest.hex("pi-runtime.span", id.value).slice(0, 16)); }
}
```

`src/domain/telemetry/SpanStatus.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Sólo UNSET y ERROR: `refused` y `aborted` no son errores del sistema y salen UNSET con su pi_runtime.status.
export class SpanStatus extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly UNSET = new SpanStatus("unset");
  static readonly ERROR = new SpanStatus("error");
  static of(raw: string): SpanStatus {
    if (raw === "unset") return SpanStatus.UNSET;
    if (raw === "error") return SpanStatus.ERROR;
    throw DomainError.because(`unknown span status ${raw}`);
  }
  isError(): boolean { return this.equals(SpanStatus.ERROR); }
}
```

`src/domain/telemetry/SpanAttributes.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";

const KEY = /^[a-z][a-z0-9_.]*$/;
const MAX_TEXT = 256;
type Value = string | number | boolean;

// Atributos de span, de evento o de recurso: sólo metadatos (nombres de tool, modelo,
// estados, contadores y bytes), nunca texto libre de Pi. Ordenados por clave; los
// null/undefined y los números no finitos se descartan; los textos se recortan.
export class SpanAttributes {
  readonly #values: ReadonlyMap<string, Value>;
  private constructor(values: Map<string, Value>) { this.#values = values; }
  static readonly NONE = new SpanAttributes(new Map());

  static of(values: Record<string, Value | null | undefined>): SpanAttributes {
    const out = new Map<string, Value>();
    for (const key of Object.keys(values).sort()) {
      if (!KEY.test(key)) throw DomainError.because(`invalid attribute key ${key}`);
      const v = values[key];
      if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) continue;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") throw DomainError.because(`invalid attribute value for ${key}`);
      out.set(key, typeof v === "string" ? v.slice(0, MAX_TEXT) : v);
    }
    return new SpanAttributes(out);
  }

  get(key: string): Value | null { return this.#values.get(key) ?? null; }
  entries(): [string, Value][] { return [...this.#values]; }
  toRecord(): Record<string, Value> { return Object.fromEntries(this.#values); }
}
```

`src/domain/telemetry/SpanEvent.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { Timestamp } from "../events/Timestamp.ts";
import type { SpanAttributes } from "./SpanAttributes.ts";

const NAMES = ["phase.changed", "model.selected", "context.compacted"];

// Evento dentro del span de sesión (spec §4).
export class SpanEvent {
  readonly name: string; readonly at: Timestamp; readonly attributes: SpanAttributes;
  private constructor(name: string, at: Timestamp, attributes: SpanAttributes) { this.name = name; this.at = at; this.attributes = attributes; }
  static of(name: string, at: Timestamp, attributes: SpanAttributes): SpanEvent {
    if (!NAMES.includes(name)) throw DomainError.because(`unknown span event ${name}`);
    return new SpanEvent(name, at, attributes);
  }
}
```

`src/domain/telemetry/SpanJson.ts`:

```ts
// Forma JSON de un span, para el estado persistido del ensamblador.
export type SpanJson = {
  traceId: string;
  spanId: string;
  parentId: string | null;
  name: string;
  startMs: number;
  endMs: number;
  status: string;
  attributes: Record<string, string | number | boolean>;
  events: { name: string; atMs: number; attributes: Record<string, string | number | boolean> }[];
};
```

`src/domain/telemetry/Span.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { Timestamp } from "../events/Timestamp.ts";
import { SpanAttributes } from "./SpanAttributes.ts";
import { SpanEvent } from "./SpanEvent.ts";
import { SpanId } from "./SpanId.ts";
import type { SpanJson } from "./SpanJson.ts";
import { SpanStatus } from "./SpanStatus.ts";
import { TraceId } from "./TraceId.ts";

const NAMES = ["session", "turn", "tool", "host", "mcp_server"];
type Props = {
  traceId: TraceId; spanId: SpanId; parentId: SpanId | null; name: string; start: Timestamp; end: Timestamp;
  status: SpanStatus; attributes: SpanAttributes; events: SpanEvent[];
};

// Un span cerrado. Un fin anterior al inicio (relojes desalineados) se ajusta al inicio.
export class Span {
  readonly traceId: TraceId; readonly spanId: SpanId; readonly parentId: SpanId | null; readonly name: string;
  readonly start: Timestamp; readonly end: Timestamp; readonly status: SpanStatus; readonly attributes: SpanAttributes; readonly events: readonly SpanEvent[];
  private constructor(p: Props) {
    this.traceId = p.traceId; this.spanId = p.spanId; this.parentId = p.parentId; this.name = p.name;
    this.start = p.start; this.end = p.end; this.status = p.status; this.attributes = p.attributes; this.events = p.events;
  }

  static of(p: Props): Span {
    if (!NAMES.includes(p.name)) throw DomainError.because(`unknown span name ${p.name}`);
    return new Span({ ...p, end: p.end.epochMs() < p.start.epochMs() ? p.start : p.end, events: [...p.events] });
  }

  durationMs(): number { return this.end.epochMs() - this.start.epochMs(); }

  toJson(): SpanJson {
    return {
      traceId: this.traceId.value, spanId: this.spanId.value, parentId: this.parentId?.value ?? null, name: this.name,
      startMs: this.start.epochMs(), endMs: this.end.epochMs(), status: this.status.value, attributes: this.attributes.toRecord(),
      events: this.events.map((e) => ({ name: e.name, atMs: e.at.epochMs(), attributes: e.attributes.toRecord() })),
    };
  }

  static fromJson(j: SpanJson): Span {
    return Span.of({
      traceId: TraceId.of(j.traceId), spanId: SpanId.of(j.spanId), parentId: j.parentId === null ? null : SpanId.of(j.parentId), name: j.name,
      start: Timestamp.fromEpochMs(j.startMs), end: Timestamp.fromEpochMs(j.endMs), status: SpanStatus.of(j.status), attributes: SpanAttributes.of(j.attributes),
      events: j.events.map((e) => SpanEvent.of(e.name, Timestamp.fromEpochMs(e.atMs), SpanAttributes.of(e.attributes))),
    });
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %, gates de arquitectura en verde (el dominio sólo importa `node:crypto`).

- [ ] **Step 5: Commit**

```bash
git add src/domain/telemetry tests/unit/domain/telemetry/spans.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(telemetría): modelo de spans con ids deterministas"
```

---

### Task 5: `SpanAssembler` — de hechos ordenados a spans cerrados

**Files:**
- Create: `src/domain/telemetry/{AssemblerState,SpanAssembler}.ts`
- Test: `tests/unit/domain/telemetry/SpanAssembler.test.ts`

**Interfaces:**
- Consumes: Task 4; E1 `EventRecord` (`id`, `stream`, `type`, `occurredAt`, `recordedAt`, `payload`), `EventId.of`, `StreamId.of`.
- Produces:
  - `type AssemblerState = { sessions: Record<stream, …>; host: … | null }` (JSON puro)
  - `new SpanAssembler(state: AssemblerState)` (clona el estado), `SpanAssembler.empty()`, `.feed(r: EventRecord): Span[]`, `.expire(now: Timestamp): Span[]`, `.flush(at: Timestamp): Span[]`, `.state(): AssemblerState` (copia)

Reglas (spec §4):
- `session`: abre con `session.opened`, cierra con `session.closed`; una reapertura cierra el span en curso con `pi_runtime.reopened=true` y abre otro en la misma traza. `phase.changed`, `model.selected` y `context.compacted` son eventos del span de sesión (tope 128).
- `turn`: de `occurredAt − durationMs` a `occurredAt` de `turn.completed`; hijo de la sesión; `ERROR` si `outcome` es `error`.
- `tool`: de `tool.started` a `tool.completed` del mismo `callId`. Pi emite `turn_end` después de ejecutar las tools del turno, así que el turno en curso sólo se conoce en su `turn.completed`: el span de tool cerrado espera en `pending` y sale con ese turno como padre; si la sesión se cierra (o se reabre) antes, sale colgado de la sesión. `failed` → `ERROR`; `refused`/`aborted` → `UNSET` con `pi_runtime.status`.
- Incompletos: un `tool.started` sin cierre sale al cerrar la sesión o a los 10 min de su `recordedAt` (`expire`), con `pi_runtime.incomplete=true`; su `callId` queda en `expired` y un cierre posterior se ignora. Un `tool` en `pending` que no ve su turno en 10 min sale colgado de la sesión.
- Host: cada `host.started` abre una traza (`TraceId.forHostRun`); un `host.started` con otro host abierto (caída) lo cierra incompleto. `mcp_server` va de `server.started` a `server.exited` con `pi_runtime.exit_code`.
- Nunca pid, rutas ni texto de Pi en atributos.

- [ ] **Step 1: Test que falla**

`tests/unit/domain/telemetry/SpanAssembler.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import type { EventRecord } from "../../../../src/domain/events/EventRecord.ts";
import type { Fact } from "../../../../src/domain/events/Fact.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { CanonicalJson } from "../../../../src/domain/shared/CanonicalJson.ts";
import type { Span } from "../../../../src/domain/telemetry/Span.ts";
import { SpanAssembler } from "../../../../src/domain/telemetry/SpanAssembler.ts";
import { SpanId } from "../../../../src/domain/telemetry/SpanId.ts";
import { TraceId } from "../../../../src/domain/telemetry/TraceId.ts";
import { SESSION, fact } from "../../../support/recordFixtures.ts";

const RECORDED = 5_000;
const H = StreamId.HOST;
function records(facts: Fact[], stream: StreamId = SESSION): EventRecord[] {
  const store = new InMemoryEventStore();
  store.append(stream, StreamVersion.NONE, facts, Timestamp.fromEpochMs(RECORDED));
  return store.readStream(stream);
}
const fresh = () => new SpanAssembler(SpanAssembler.empty());
const feedAll = (a: SpanAssembler, rs: EventRecord[]) => rs.flatMap((r) => a.feed(r));
const pick = (spans: Span[], name: string, attr?: [string, unknown]) => spans.filter((s) => s.name === name && (attr === undefined || s.attributes.get(attr[0]) === attr[1]));

const SESSION_FACTS = () => [
  fact("session.opened", "o", { reason: "startup", piRuntimeVersion: "0.1.0" }, SESSION, 1000),
  fact("phase.changed", "p", { from: null, to: "interactive", activeTools: 3 }, SESSION, 1100),
  fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1", argsBytes: 12 }, SESSION, 2000),
  fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 400, status: "succeeded", outputBytes: 99 }, SESSION, 2400),
  fact("tool.started", "c2s", { tool: "bash", server: "pi", callId: "c2" }, SESSION, 2500),
  fact("tool.completed", "c2", { tool: "bash", server: "pi", callId: "c2", durationMs: 100, status: "failed", errorKind: "tool_error" }, SESSION, 2600),
  fact("turn.completed", "t1", { model: "m", provider: "p", tokens: { input: 10, output: 3, cacheRead: 1, cacheWrite: 0 }, cost: 0.25, durationMs: 1500, outcome: "completed", stopReason: "toolUse" }, SESSION, 3000),
  fact("tool.started", "c3s", { tool: "kmp_ingest", server: "kmp", callId: "c3" }, SESSION, 3100),
  fact("tool.completed", "c3", { tool: "kmp_ingest", server: "kmp", callId: "c3", durationMs: 100, status: "refused", errorKind: "refused", errorCode: "invalid_argument" }, SESSION, 3200),
  fact("session.closed", "x", { reason: "quit" }, SESSION, 4000),
];

test("empareja tools por callId, las cuelga del turno en curso y el turno de la sesión", () => {
  const rs = records(SESSION_FACTS());
  const a = fresh();
  assert.deepEqual(rs.map((r) => a.feed(r).map((s) => s.name).join(",")), ["", "", "", "", "", "", "turn,tool,tool", "", "", "session,tool"]);
  const spans = feedAll(fresh(), rs);
  assert.ok(spans.every((s) => s.traceId.equals(TraceId.forStream(SESSION))));
  const [session] = pick(spans, "session"); const [turn] = pick(spans, "turn");
  const [ask] = pick(spans, "tool", ["pi_runtime.tool", "kmp_ask"]); const [bash] = pick(spans, "tool", ["pi_runtime.tool", "bash"]);
  const [ingest] = pick(spans, "tool", ["pi_runtime.tool", "kmp_ingest"]);
  assert.ok(session.spanId.equals(SpanId.forEvent(rs[0].id)));
  assert.equal(session.parentId, null);
  assert.deepEqual([session.start.epochMs(), session.end.epochMs()], [1000, 4000]);
  assert.deepEqual(session.events.map((e) => [e.name, e.at.epochMs(), e.attributes.get("pi_runtime.phase.to")]), [["phase.changed", 1100, "interactive"]]);
  assert.deepEqual([session.attributes.get("pi_runtime.close_reason"), session.attributes.get("pi_runtime.session_id"), session.attributes.get("pi_runtime.open_reason")], ["quit", "s1", "startup"]);
  assert.ok(turn.parentId?.equals(session.spanId));
  assert.ok(turn.spanId.equals(SpanId.forEvent(rs[6].id)));
  assert.deepEqual([turn.start.epochMs(), turn.end.epochMs()], [1500, 3000]);
  assert.deepEqual(["pi_runtime.model", "pi_runtime.tokens.input", "pi_runtime.tokens.output", "pi_runtime.cost", "pi_runtime.outcome", "pi_runtime.stop_reason"].map((k) => turn.attributes.get(k)),
    ["m", 10, 3, 0.25, "completed", "toolUse"]);
  assert.ok(ask.parentId?.equals(turn.spanId));
  assert.ok(bash.parentId?.equals(turn.spanId));
  assert.ok(ask.spanId.equals(SpanId.forEvent(rs[2].id)), "el span de la tool lo abre tool.started");
  assert.deepEqual([ask.start.epochMs(), ask.end.epochMs(), ask.status.value, ask.attributes.get("pi_runtime.args_bytes"), ask.attributes.get("pi_runtime.output_bytes")], [2000, 2400, "unset", 12, 99]);
  assert.equal(bash.status.value, "error");
  assert.ok(ingest.parentId?.equals(session.spanId), "sin turno posterior cuelga de la sesión");
  assert.deepEqual([ingest.status.value, ingest.attributes.get("pi_runtime.status"), ingest.attributes.get("pi_runtime.error_code")], ["unset", "refused", "invalid_argument"]);
});

test("una tool sin cierre sale incompleta a los 10 min de recordedAt; un cierre tardío se ignora", () => {
  const rs = records([
    fact("session.opened", "o", {}, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }, SESSION, 2000),
    fact("tool.started", "c2s", { tool: "kmp_ask", server: "kmp", callId: "c2" }, SESSION, 2100),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 700_000, status: "succeeded" }, SESSION, 702_000),
    fact("session.closed", "x", {}, SESSION, 800_000),
  ]);
  const a = fresh();
  feedAll(a, rs.slice(0, 3));
  assert.deepEqual(a.expire(Timestamp.fromEpochMs(RECORDED + 600_000 - 1)), []);
  const expired = a.expire(Timestamp.fromEpochMs(RECORDED + 600_000));
  assert.equal(expired.length, 2);
  assert.ok(expired.every((s) => s.name === "tool" && s.attributes.get("pi_runtime.incomplete") === true && s.status.value === "unset"));
  assert.deepEqual(expired.map((s) => s.end.epochMs()), [RECORDED + 600_000, RECORDED + 600_000]);
  assert.deepEqual(a.feed(rs[3]), [], "el cierre tardío de c1 se ignora: su span ya salió");
  assert.deepEqual(a.feed(rs[4]).map((s) => s.name), ["session"]);
});

test("al cerrar la sesión las tools abiertas salen incompletas con el fin de la sesión", () => {
  const rs = records([fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 2000), fact("session.closed", "x", {}, SESSION, 3000)]);
  const [tool] = pick(feedAll(fresh(), rs), "tool");
  assert.deepEqual([tool.start.epochMs(), tool.end.epochMs(), tool.attributes.get("pi_runtime.incomplete")], [2000, 3000, true]);
  assert.ok(tool.spanId.equals(SpanId.forEvent(rs[1].id)));
});

test("una tool cerrada que no ve su turno sale colgada de la sesión a los 10 min; sin tool.started el inicio sale de durationMs", () => {
  const rs = records([fact("session.opened", "o", {}, SESSION, 1000), fact("tool.completed", "c9", { tool: "t", server: "pi", callId: "c9", durationMs: 300, status: "succeeded" }, SESSION, 2000)]);
  const a = fresh();
  assert.deepEqual(feedAll(a, rs), []);
  assert.deepEqual(a.expire(Timestamp.fromEpochMs(RECORDED + 599_999)), []);
  const [tool] = a.expire(Timestamp.fromEpochMs(RECORDED + 600_000));
  assert.deepEqual([tool.start.epochMs(), tool.end.epochMs()], [1700, 2000]);
  assert.ok(tool.spanId.equals(SpanId.forEvent(rs[1].id)));
  assert.ok(tool.parentId?.equals(SpanId.forEvent(rs[0].id)));
});

test("una reapertura cierra el span en curso (reopened) y abre otro en la misma traza", () => {
  const rs = records([
    fact("session.opened", "o1", {}, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 1500),
    fact("session.opened", "o2", { reason: "resume" }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "t", server: "pi", callId: "c1", status: "succeeded" }, SESSION, 2500),
    fact("session.closed", "x", {}, SESSION, 3000),
  ]);
  const a = fresh();
  feedAll(a, rs.slice(0, 2));
  const atReopen = a.feed(rs[2]);
  assert.deepEqual(atReopen.map((s) => [s.name, s.end.epochMs(), s.attributes.get("pi_runtime.reopened") ?? s.attributes.get("pi_runtime.incomplete")]), [["session", 2000, true], ["tool", 2000, true]]);
  assert.deepEqual(a.feed(rs[3]), [], "la tool ya salió incompleta en la reapertura");
  const [second] = a.feed(rs[4]);
  assert.ok(second.spanId.equals(SpanId.forEvent(rs[2].id)));
  assert.ok(second.traceId.equals(atReopen[0].traceId));
  assert.deepEqual([second.start.epochMs(), second.end.epochMs(), second.attributes.get("pi_runtime.open_reason")], [2000, 3000, "resume"]);
});

test("ids deterministas y reinicio a mitad de lote: el estado serializado continúa igual", () => {
  const rs = records(SESSION_FACTS());
  const whole = feedAll(fresh(), rs).map((s) => s.toJson());
  assert.deepEqual(feedAll(fresh(), records(SESSION_FACTS())).map((s) => s.toJson()), whole);
  for (let cut = 0; cut <= rs.length; cut++) {
    const first = fresh();
    const before = feedAll(first, rs.slice(0, cut));
    const restored = new SpanAssembler(JSON.parse(CanonicalJson.of(first.state()).text));
    assert.deepEqual([...before, ...feedAll(restored, rs.slice(cut))].map((s) => s.toJson()), whole, `corte en ${cut}`);
  }
});

test("un turno con outcome error sale con status ERROR; sin durationMs empieza en su fin", () => {
  const [turn] = feedAll(fresh(), records([fact("session.opened", "o", {}, SESSION, 1000), fact("turn.completed", "t", { outcome: "error" }, SESSION, 2000)]));
  assert.deepEqual([turn.status.value, turn.start.epochMs(), turn.end.epochMs()], ["error", 2000, 2000]);
});

test("model.selected y context.compacted son eventos del span de sesión, con tope de 128", () => {
  const facts = [fact("session.opened", "o", {}, SESSION, 1000), fact("model.selected", "m", { model: "m2", provider: "p", effort: "high" }, SESSION, 1100),
    fact("context.compacted", "k", { tokensBefore: 100, tokensAfter: 10, reason: "threshold" }, SESSION, 1200),
    ...Array.from({ length: 200 }, (_, i) => fact("phase.changed", `p${i}`, { to: "design" }, SESSION, 1300 + i)), fact("session.closed", "x", {}, SESSION, 9000)];
  const [session] = feedAll(fresh(), records(facts));
  assert.equal(session.events.length, 128);
  assert.deepEqual(session.events.slice(0, 2).map((e) => [e.name, e.attributes.toRecord()]), [
    ["model.selected", { "pi_runtime.effort": "high", "pi_runtime.model": "m2", "pi_runtime.provider": "p" }],
    ["context.compacted", { "pi_runtime.reason": "threshold", "pi_runtime.tokens_after": 10, "pi_runtime.tokens_before": 100 }],
  ]);
});

test("host: una traza por arranque, span host hasta host.stopped y spans mcp_server con su código de salida", () => {
  const rs = records([
    fact("host.started", "h1", { version: "0.1.0", pid: 42 }, H, 1000),
    fact("server.started", "s1", { server: "kmp", name: "kmp", version: "1.0.0" }, H, 1100),
    fact("server.exited", "s2", { server: "kmp", code: 0 }, H, 1900),
    fact("server.started", "s3", { server: "made", name: "made", version: "2.0.0" }, H, 2000),
    fact("host.stopped", "h2", { reason: "idle" }, H, 3000),
    fact("host.started", "h3", { version: "0.1.0", pid: 43 }, H, 4000),
    fact("server.started", "s4", { server: "kmp", version: "1.0.0" }, H, 4100),
    fact("server.started", "s5", { server: "kmp", version: "1.0.0" }, H, 4200),
    fact("host.started", "h4", { version: "0.1.1", pid: 44 }, H, 5000),
  ], H);
  const a = fresh();
  const byEvent = rs.map((r) => a.feed(r));
  const run1 = TraceId.forHostRun(rs[0].id);
  const [kmp] = byEvent[2];
  assert.deepEqual([kmp.name, kmp.start.epochMs(), kmp.end.epochMs(), kmp.attributes.get("pi_runtime.exit_code"), kmp.attributes.get("pi_runtime.server")], ["mcp_server", 1100, 1900, 0, "kmp"]);
  assert.ok(kmp.traceId.equals(run1));
  assert.ok(kmp.parentId?.equals(SpanId.forEvent(rs[0].id)));
  const [host, made] = byEvent[4];
  assert.deepEqual([host.name, host.start.epochMs(), host.end.epochMs()], ["host", 1000, 3000]);
  assert.deepEqual(Object.keys(host.attributes.toRecord()), ["pi_runtime.stop_reason", "pi_runtime.version"], "ni pid ni nada de la máquina");
  assert.deepEqual([made.name, made.attributes.get("pi_runtime.incomplete")], ["mcp_server", true]);
  assert.deepEqual(byEvent[7].map((s) => [s.name, s.end.epochMs(), s.attributes.get("pi_runtime.incomplete")]), [["mcp_server", 4200, true]], "un segundo server.started cierra el anterior");
  const [crashed, stillOpen] = byEvent[8];
  assert.deepEqual([crashed.name, crashed.end.epochMs(), crashed.attributes.get("pi_runtime.incomplete")], ["host", 5000, true]);
  assert.ok(crashed.traceId.equals(TraceId.forHostRun(rs[5].id)));
  assert.equal(crashed.traceId.equals(run1), false);
  assert.deepEqual([stillOpen.name, stillOpen.attributes.get("pi_runtime.incomplete")], ["mcp_server", true]);
});

test("hechos sin sesión o sin host abiertos no emiten nada; flush cierra todo como incompleto", () => {
  const orphan = records([fact("tool.completed", "c", { callId: "c", status: "succeeded" }, SESSION, 1000), fact("turn.completed", "t", {}, SESSION, 1100),
    fact("tool.started", "d", { callId: "d" }, SESSION, 1200), fact("phase.changed", "p", { to: "design" }, SESSION, 1300), fact("session.closed", "x", {}, SESSION, 1400)]);
  assert.deepEqual(feedAll(fresh(), orphan), []);
  const hostOrphan = records([fact("server.exited", "e", { server: "kmp" }, H, 1000), fact("host.stopped", "s", {}, H, 1100), fact("server.started", "x", { server: "kmp" }, H, 1200)], H);
  assert.deepEqual(feedAll(fresh(), hostOrphan), []);
  const a = fresh();
  feedAll(a, records([fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 1500)]));
  feedAll(a, records([fact("host.started", "h", {}, H, 900), fact("server.started", "s", { server: "kmp" }, H, 950)], H));
  const flushed = a.flush(Timestamp.fromEpochMs(2000));
  assert.deepEqual(flushed.map((s) => [s.name, s.end.epochMs(), s.attributes.get("pi_runtime.incomplete")]), [["session", 2000, true], ["tool", 2000, true], ["host", 2000, true], ["mcp_server", 2000, true]]);
  assert.deepEqual(a.state(), SpanAssembler.empty());
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/domain/telemetry/SpanAssembler.test.ts`
Expected: FAIL por `Cannot find module …/SpanAssembler.ts`.

- [ ] **Step 3: Implementar**

`src/domain/telemetry/AssemblerState.ts`:

```ts
import type { SpanJson } from "./SpanJson.ts";

type Attrs = Record<string, string | number | boolean>;
type OpenSpan = { spanId: string; startMs: number; attributes: Attrs };
type OpenTool = { eventId: string; startMs: number; recordedAtMs: number; attributes: Attrs };

// Estado explícito y serializable (JSON) del ensamblador: sesiones y host abiertos, tools
// en curso, spans de tool que esperan a su turno y callIds ya emitidos como incompletos.
// Se guarda en projection_state del consumidor `otlp_traces`: un reinicio no pierde spans.
export type AssemblerState = {
  sessions: Record<string, OpenSpan & {
    events: { name: string; atMs: number; attributes: Attrs }[];
    tools: Record<string, OpenTool>;
    pending: { span: SpanJson; recordedAtMs: number }[];
    expired: string[];
  }>;
  host: (OpenSpan & { traceId: string; servers: Record<string, OpenSpan> }) | null;
};
```

`src/domain/telemetry/SpanAssembler.ts`:

```ts
import { EventId } from "../events/EventId.ts";
import type { EventRecord } from "../events/EventRecord.ts";
import { StreamId } from "../events/StreamId.ts";
import { Timestamp } from "../events/Timestamp.ts";
import type { AssemblerState } from "./AssemblerState.ts";
import { Span } from "./Span.ts";
import { SpanAttributes } from "./SpanAttributes.ts";
import { SpanEvent } from "./SpanEvent.ts";
import { SpanId } from "./SpanId.ts";
import type { SpanJson } from "./SpanJson.ts";
import { SpanStatus } from "./SpanStatus.ts";
import { TraceId } from "./TraceId.ts";

type Json = Record<string, unknown>;
type Extra = Record<string, string | number | boolean | null>;
type Session = AssemblerState["sessions"][string];
type OpenTool = Session["tools"][string];
type Host = NonNullable<AssemblerState["host"]>;
type OpenServer = Host["servers"][string];

const INCOMPLETE_AFTER_MS = 10 * 60_000;
const MAX_SESSION_EVENTS = 128;
const MAX_EXPIRED = 512;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const attrs = (values: Extra) => SpanAttributes.of(values).toRecord();
const at = (ms: number) => Timestamp.fromEpochMs(Math.max(0, Math.round(ms)));

// Convierte hechos ordenados en spans cerrados (spec §4). Determinista: sin reloj ni
// E/S; el único tiempo externo es el `now` de expire. El estado es explícito y JSON.
export class SpanAssembler {
  readonly #state: AssemblerState;
  constructor(state: AssemblerState) { this.#state = structuredClone(state); }

  static empty(): AssemblerState { return { sessions: {}, host: null }; }
  state(): AssemblerState { return structuredClone(this.#state); }

  feed(r: EventRecord): Span[] { return r.stream.isSession() ? this.#session(r) : this.#host(r); }

  // Tools sin cierre (o cerradas sin turno) con más de 10 min desde su recordedAt.
  expire(now: Timestamp): Span[] {
    const out: Span[] = [];
    for (const [stream, s] of Object.entries(this.#state.sessions)) {
      const trace = TraceId.forStream(StreamId.of(stream)); const parent = SpanId.of(s.spanId);
      for (const [callId, t] of Object.entries(s.tools)) {
        const deadline = t.recordedAtMs + INCOMPLETE_AFTER_MS;
        if (now.epochMs() < deadline) continue;
        out.push(this.#incomplete(trace, parent, t, deadline));
        delete s.tools[callId];
        this.#expire(s, callId);
      }
      const due = s.pending.filter((x) => now.epochMs() >= x.recordedAtMs + INCOMPLETE_AFTER_MS);
      s.pending = s.pending.filter((x) => !due.includes(x));
      out.push(...due.map((x) => SpanAssembler.#withParent(x.span, parent)));
    }
    return out;
  }

  // Cierra todo lo abierto como incompleto (para `events trace`, que muestra también lo que sigue en curso).
  flush(when: Timestamp): Span[] {
    const out: Span[] = [];
    for (const stream of Object.keys(this.#state.sessions)) {
      const s = this.#state.sessions[stream];
      delete this.#state.sessions[stream];
      out.push(...this.#closeSession(StreamId.of(stream), s, when.epochMs(), { "pi_runtime.incomplete": true }));
    }
    const h = this.#state.host;
    if (h !== null) { this.#state.host = null; out.push(...this.#closeHost(h, when.epochMs(), { "pi_runtime.incomplete": true })); }
    return out;
  }

  #session(r: EventRecord): Span[] {
    const key = r.stream.value; const s = this.#state.sessions[key]; const p = obj(r.payload.toValue()); const ms = r.occurredAt.epochMs();
    switch (r.type.value) {
      case "session.opened": {
        const out = s ? this.#closeSession(r.stream, s, ms, { "pi_runtime.reopened": true }) : [];
        this.#state.sessions[key] = {
          spanId: SpanId.forEvent(r.id).value, startMs: ms,
          attributes: attrs({ "pi_runtime.session_id": r.stream.sessionId().value, "pi_runtime.open_reason": str(p.reason), "pi_runtime.version": str(p.piRuntimeVersion), "pi_runtime.pi_version": str(p.piVersion) }),
          events: [], tools: {}, pending: [], expired: s ? s.expired : [],
        };
        return out;
      }
      case "session.closed":
        if (!s) return [];
        delete this.#state.sessions[key];
        return this.#closeSession(r.stream, s, ms, { "pi_runtime.close_reason": str(p.reason) });
      case "phase.changed": return this.#event(s, "phase.changed", ms, { "pi_runtime.phase.from": str(p.from), "pi_runtime.phase.to": str(p.to), "pi_runtime.active_tools": num(p.activeTools) });
      case "model.selected": return this.#event(s, "model.selected", ms, { "pi_runtime.model": str(p.model), "pi_runtime.provider": str(p.provider), "pi_runtime.effort": str(p.effort) });
      case "context.compacted": return this.#event(s, "context.compacted", ms, { "pi_runtime.tokens_before": num(p.tokensBefore), "pi_runtime.tokens_after": num(p.tokensAfter), "pi_runtime.reason": str(p.reason) });
      case "tool.started": {
        const callId = str(p.callId);
        if (!s || callId === null || s.expired.includes(callId)) return [];
        s.tools[callId] = { eventId: r.id.value, startMs: ms, recordedAtMs: r.recordedAt.epochMs(), attributes: attrs({ "pi_runtime.tool": str(p.tool), "pi_runtime.server": str(p.server), "pi_runtime.args_bytes": num(p.argsBytes) }) };
        return [];
      }
      case "tool.completed": {
        const callId = str(p.callId);
        if (!s || callId === null || s.expired.includes(callId)) return [];
        const open = s.tools[callId];
        delete s.tools[callId];
        const status = str(p.status);
        const span = Span.of({
          traceId: TraceId.forStream(r.stream), spanId: SpanId.forEvent(open ? EventId.of(open.eventId) : r.id), parentId: null, name: "tool",
          start: at(open?.startMs ?? ms - (num(p.durationMs) ?? 0)), end: r.occurredAt, status: status === "failed" ? SpanStatus.ERROR : SpanStatus.UNSET,
          attributes: SpanAttributes.of({ ...(open?.attributes ?? {}), "pi_runtime.tool": str(p.tool), "pi_runtime.server": str(p.server), "pi_runtime.status": status,
            "pi_runtime.error_kind": str(p.errorKind), "pi_runtime.error_code": str(p.errorCode), "pi_runtime.output_bytes": num(p.outputBytes) }),
          events: [],
        });
        s.pending.push({ span: span.toJson(), recordedAtMs: r.recordedAt.epochMs() });
        return [];
      }
      case "turn.completed": {
        if (!s) return [];
        const tokens = obj(p.tokens); const turnId = SpanId.forEvent(r.id);
        const turn = Span.of({
          traceId: TraceId.forStream(r.stream), spanId: turnId, parentId: SpanId.of(s.spanId), name: "turn",
          start: at(ms - (num(p.durationMs) ?? 0)), end: r.occurredAt, status: p.outcome === "error" ? SpanStatus.ERROR : SpanStatus.UNSET,
          attributes: SpanAttributes.of({ "pi_runtime.model": str(p.model), "pi_runtime.provider": str(p.provider), "pi_runtime.tokens.input": num(tokens.input),
            "pi_runtime.tokens.output": num(tokens.output), "pi_runtime.tokens.cache_read": num(tokens.cacheRead), "pi_runtime.tokens.cache_write": num(tokens.cacheWrite),
            "pi_runtime.cost": num(p.cost), "pi_runtime.outcome": str(p.outcome), "pi_runtime.stop_reason": str(p.stopReason) }),
          events: [],
        });
        return [turn, ...s.pending.splice(0).map((x) => SpanAssembler.#withParent(x.span, turnId))];
      }
      default: return [];
    }
  }

  #event(s: Session | undefined, name: string, ms: number, values: Extra): Span[] {
    if (s && s.events.length < MAX_SESSION_EVENTS) s.events.push({ name, atMs: ms, attributes: attrs(values) });
    return [];
  }

  #closeSession(stream: StreamId, s: Session, ms: number, extra: Extra): Span[] {
    const trace = TraceId.forStream(stream); const sessionId = SpanId.of(s.spanId);
    const out: Span[] = [Span.of({
      traceId: trace, spanId: sessionId, parentId: null, name: "session", start: at(s.startMs), end: at(ms), status: SpanStatus.UNSET,
      attributes: SpanAttributes.of({ ...s.attributes, ...extra }),
      events: s.events.map((e) => SpanEvent.of(e.name, at(e.atMs), SpanAttributes.of(e.attributes))),
    })];
    out.push(...s.pending.splice(0).map((x) => SpanAssembler.#withParent(x.span, sessionId)));
    for (const [callId, t] of Object.entries(s.tools)) { out.push(this.#incomplete(trace, sessionId, t, ms)); this.#expire(s, callId); }
    s.tools = {};
    return out;
  }

  #incomplete(trace: TraceId, parent: SpanId, t: OpenTool, endMs: number): Span {
    return Span.of({ traceId: trace, spanId: SpanId.forEvent(EventId.of(t.eventId)), parentId: parent, name: "tool", start: at(t.startMs), end: at(Math.max(t.startMs, endMs)),
      status: SpanStatus.UNSET, attributes: SpanAttributes.of({ ...t.attributes, "pi_runtime.incomplete": true }), events: [] });
  }

  #expire(s: Session, callId: string): void { s.expired = [...s.expired, callId].slice(-MAX_EXPIRED); }

  static #withParent(span: SpanJson, parent: SpanId): Span { return Span.fromJson({ ...span, parentId: parent.value }); }

  #host(r: EventRecord): Span[] {
    const p = obj(r.payload.toValue()); const ms = r.occurredAt.epochMs(); const h = this.#state.host;
    switch (r.type.value) {
      case "host.started": {
        const out = h ? this.#closeHost(h, ms, { "pi_runtime.incomplete": true }) : [];
        this.#state.host = { traceId: TraceId.forHostRun(r.id).value, spanId: SpanId.forEvent(r.id).value, startMs: ms, attributes: attrs({ "pi_runtime.version": str(p.version) }), servers: {} };
        return out;
      }
      case "host.stopped":
        if (!h) return [];
        this.#state.host = null;
        return this.#closeHost(h, ms, { "pi_runtime.stop_reason": str(p.reason) });
      case "server.started": {
        if (!h) return [];
        const server = str(p.server) ?? "unknown"; const previous = h.servers[server];
        h.servers[server] = { spanId: SpanId.forEvent(r.id).value, startMs: ms, attributes: attrs({ "pi_runtime.server": server, "pi_runtime.server_version": str(p.version) }) };
        return previous ? [this.#server(h, previous, ms, { "pi_runtime.incomplete": true })] : [];
      }
      case "server.exited": {
        const server = str(p.server) ?? "unknown"; const open = h?.servers[server];
        if (!h || !open) return [];
        delete h.servers[server];
        return [this.#server(h, open, ms, { "pi_runtime.exit_code": typeof p.code === "number" && Number.isInteger(p.code) ? p.code : "unknown" })];
      }
      default: return [];
    }
  }

  #closeHost(h: Host, ms: number, extra: Extra): Span[] {
    const servers = Object.values(h.servers).map((s) => this.#server(h, s, ms, { "pi_runtime.incomplete": true }));
    return [Span.of({ traceId: TraceId.of(h.traceId), spanId: SpanId.of(h.spanId), parentId: null, name: "host", start: at(h.startMs), end: at(ms), status: SpanStatus.UNSET,
      attributes: SpanAttributes.of({ ...h.attributes, ...extra }), events: [] }), ...servers];
  }

  #server(h: Host, s: OpenServer, ms: number, extra: Extra): Span {
    return Span.of({ traceId: TraceId.of(h.traceId), spanId: SpanId.of(s.spanId), parentId: SpanId.of(h.spanId), name: "mcp_server", start: at(s.startMs), end: at(ms),
      status: SpanStatus.UNSET, attributes: SpanAttributes.of({ ...s.attributes, ...extra }), events: [] });
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src/domain/telemetry tests/unit/domain/telemetry/SpanAssembler.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(telemetría): SpanAssembler puro con estado explícito, incompletos y reapertura"
```

---

### Task 6: Puerto `TelemetrySink`, recurso y exportación de trazas con cursor propio

**Files:**
- Create: `src/domain/telemetry/{ExportResult,OtelKeyValueList,TelemetryResource}.ts`, `src/application/ports/TelemetrySink.ts`, `src/application/services/ExportBackoff.ts`, `src/application/use-cases/TraceExport.ts`, `tests/support/FakeTelemetrySink.ts`
- Test: `tests/unit/domain/telemetry/export.test.ts`, `tests/unit/application/services/ExportBackoff.test.ts`, `tests/unit/application/use-cases/TraceExport.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5; E1 `ProjectionStore` (`snapshot`, `commit` con compare-and-set, `reset`, `cursor`), `ProjectionCursor.of`, `GlobalPosition`, `EventStore.readAll/lastPosition`, `ProjectId`.
- Produces:
  - `ExportResult.ok()`, `.rejected(reason)`, `.retryable(reason)`, `.ofStatus(httpStatus)`; campos `kind: "ok" | "rejected" | "retryable"`, `reason: string`
  - `OtelKeyValueList.parse(raw)`, `OtelKeyValueList.EMPTY`, `.entries()`, `.keys()`, `.get(k)`, `.isEmpty()`
  - `TelemetryResource.of(version: string, project: ProjectId, extra = OtelKeyValueList.EMPTY)`, `.attributes(): SpanAttributes`
  - `interface TelemetrySink { sendSpans(resource, spans: Span[]): Promise<ExportResult>; sendMetrics(resource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Promise<ExportResult> }`
  - `ExportBackoff.first(nowMs)`, `.failedAgain(nowMs)`, `.failures()`, `.nextAttemptMs()`, `.isDue(nowMs)` (1 s doblando hasta 5 min)
  - `TraceExport.NAME` (`otlp_traces`), `TraceExport.VERSION` (1), `new TraceExport(events, store, sink, resource)`, `.execute(now: Timestamp): Promise<ExportResult>`, `.lag(): number`
  - `tests/support/FakeTelemetrySink` (`batches`, `metrics`, `results`)

- [ ] **Step 1: Tests que fallan**

`tests/support/FakeTelemetrySink.ts`:

```ts
import type { TelemetrySink } from "../../src/application/ports/TelemetrySink.ts";
import type { Timestamp } from "../../src/domain/events/Timestamp.ts";
import { ExportResult } from "../../src/domain/telemetry/ExportResult.ts";
import type { MetricsSnapshot } from "../../src/domain/telemetry/MetricsSnapshot.ts";
import type { Span } from "../../src/domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../src/domain/telemetry/TelemetryResource.ts";

// Guarda lo enviado y responde con `results` en orden (ok cuando se agotan).
export class FakeTelemetrySink implements TelemetrySink {
  readonly batches: Span[][] = [];
  readonly metrics: { snapshot: MetricsSnapshot; start: Timestamp; at: Timestamp }[] = [];
  readonly results: ExportResult[] = [];
  async sendSpans(_resource: TelemetryResource, spans: Span[]): Promise<ExportResult> { this.batches.push(spans); return this.results.shift() ?? ExportResult.ok(); }
  async sendMetrics(_resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Promise<ExportResult> {
    this.metrics.push({ snapshot, start, at });
    return this.results.shift() ?? ExportResult.ok();
  }
}
```

`tests/unit/domain/telemetry/export.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { ExportResult } from "../../../../src/domain/telemetry/ExportResult.ts";
import { OtelKeyValueList } from "../../../../src/domain/telemetry/OtelKeyValueList.ts";
import { TelemetryResource } from "../../../../src/domain/telemetry/TelemetryResource.ts";

test("resultado de exportación por código HTTP: 2xx ok, 429 y 5xx reintento, el resto se descarta", () => {
  assert.equal(ExportResult.ofStatus(200).kind, "ok");
  assert.equal(ExportResult.ofStatus(204).kind, "ok");
  assert.deepEqual([ExportResult.ofStatus(429).kind, ExportResult.ofStatus(429).reason], ["retryable", "http 429"]);
  assert.equal(ExportResult.ofStatus(503).kind, "retryable");
  assert.deepEqual([ExportResult.ofStatus(400).kind, ExportResult.ofStatus(400).reason], ["rejected", "http 400"]);
  assert.equal(ExportResult.ofStatus(302).kind, "rejected");
  assert.deepEqual([ExportResult.retryable("timeout").kind, ExportResult.rejected("x").kind, ExportResult.ok().reason], ["retryable", "rejected", "ok"]);
});

test("listas k=v de OTEL: percent-decoding, entradas vacías ignoradas y errores sin repetir la entrada", () => {
  const l = OtelKeyValueList.parse(" authorization=Bearer%20abc , x-tenant=acme,, empty= ");
  assert.deepEqual(l.entries(), [["authorization", "Bearer abc"], ["x-tenant", "acme"], ["empty", ""]]);
  assert.deepEqual(l.keys(), ["authorization", "x-tenant", "empty"]);
  assert.equal(l.get("x-tenant"), "acme");
  assert.equal(l.get("nope"), null);
  assert.ok(OtelKeyValueList.parse("").isEmpty());
  assert.ok(OtelKeyValueList.EMPTY.isEmpty());
  for (const bad of ["secret-token-without-key", "=secret", "k=%zzsecret"]) {
    assert.throws(() => OtelKeyValueList.parse(bad), (e: Error) => e instanceof DomainError && !e.message.includes("secret"), bad);
  }
  assert.throws(() => OtelKeyValueList.parse(undefined as never), DomainError);
});

test("recurso: service.name, versión y proyecto con hash; OTEL_RESOURCE_ATTRIBUTES sin máquina, usuario ni rutas", () => {
  const extra = OtelKeyValueList.parse("deployment.environment=dev,host.name=box,process.owner=tirso,user.id=u,os.type=linux,service.name=impostor,team.dir=/home/u,Bad=1,service.namespace=underpass");
  assert.deepEqual(TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"), extra).attributes().toRecord(), {
    "deployment.environment": "dev", "pi_runtime.project": "0123456789abcdef", "service.name": "pi-runtime", "service.namespace": "underpass", "service.version": "0.1.0",
  });
  assert.deepEqual(TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef")).attributes().toRecord(), {
    "pi_runtime.project": "0123456789abcdef", "service.name": "pi-runtime", "service.version": "0.1.0",
  });
});
```

`tests/unit/application/services/ExportBackoff.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ExportBackoff } from "../../../../src/application/services/ExportBackoff.ts";

test("retroceso de exportación: 1 s, doblando en cada fallo seguido, con tope de 5 min", () => {
  let b = ExportBackoff.first(1000);
  assert.deepEqual([b.failures(), b.nextAttemptMs(), b.isDue(1999), b.isDue(2000)], [1, 2000, false, true]);
  b = b.failedAgain(2000);
  assert.deepEqual([b.failures(), b.nextAttemptMs()], [2, 4000]);
  for (let i = 0; i < 20; i++) b = b.failedAgain(10_000);
  assert.equal(b.nextAttemptMs(), 10_000 + 300_000);
});
```

`tests/unit/application/use-cases/TraceExport.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { TraceExport } from "../../../../src/application/use-cases/TraceExport.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { ExportResult } from "../../../../src/domain/telemetry/ExportResult.ts";
import type { Span } from "../../../../src/domain/telemetry/Span.ts";
import { TelemetryResource } from "../../../../src/domain/telemetry/TelemetryResource.ts";
import { FakeTelemetrySink } from "../../../support/FakeTelemetrySink.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const RESOURCE = TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"));
const NOW = Timestamp.fromEpochMs(10_000);

function session(events: EventStore, calls = 1): void {
  const facts = [fact("session.opened", "o", {}, SESSION, 1000)];
  for (let i = 0; i < calls; i++) facts.push(
    fact("tool.started", `c${i}s`, { tool: "kmp_ask", server: "kmp", callId: `c${i}` }, SESSION, 2000),
    fact("tool.completed", `c${i}`, { tool: "kmp_ask", server: "kmp", callId: `c${i}`, durationMs: 5, status: "succeeded" }, SESSION, 2005),
    fact("turn.completed", `t${i}`, { durationMs: 10 }, SESSION, 2010));
  facts.push(fact("session.closed", "x", {}, SESSION, 3000));
  events.append(SESSION, StreamVersion.NONE, facts, AT);
}
function setup() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const sink = new FakeTelemetrySink();
  return { events, store, sink, exporter: new TraceExport(events, store, sink, RESOURCE) };
}
const ids = (batches: Span[][]) => batches.flat().map((s) => s.spanId.value);

test("envía los spans ensamblados y sólo avanza el cursor tras un 2xx", async () => {
  const { events, store, sink, exporter } = setup();
  session(events);
  assert.equal(exporter.lag(), 5);
  assert.equal((await exporter.execute(NOW)).kind, "ok");
  assert.deepEqual(sink.batches.map((b) => b.map((s) => s.name)), [["turn", "tool", "session"]]);
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 5);
  assert.equal(exporter.lag(), 0);
  await exporter.execute(NOW);
  assert.equal(sink.batches.length, 1, "sin nada nuevo no se envía nada");
});

test("un 5xx, 429 o error de red no avanza el cursor y el reintento envía los mismos ids", async () => {
  const { events, store, sink, exporter } = setup();
  session(events);
  sink.results.push(ExportResult.retryable("http 503"));
  assert.deepEqual(await exporter.execute(NOW), ExportResult.retryable("http 503"));
  assert.equal(exporter.lag(), 5);
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 0);
  assert.equal((await exporter.execute(NOW)).kind, "ok");
  assert.deepEqual(ids([sink.batches[1]]), ids([sink.batches[0]]));
  assert.equal(exporter.lag(), 0);
});

test("un 4xx (que no es 429) descarta el lote con aviso y avanza", async () => {
  const { events, sink, exporter } = setup();
  session(events);
  sink.results.push(ExportResult.rejected("http 400"));
  const r = await exporter.execute(NOW);
  assert.deepEqual([r.kind, r.reason], ["rejected", "http 400"]);
  assert.equal(exporter.lag(), 0);
  await exporter.execute(NOW);
  assert.equal(sink.batches.length, 1);
});

test("lotes de hasta 512 spans: un hecho que suelta muchos se trocea", async () => {
  const { events, sink, exporter } = setup();
  const facts = [fact("session.opened", "o", {}, SESSION, 1000)];
  for (let i = 0; i < 600; i++) facts.push(fact("tool.completed", `c${i}`, { tool: "t", server: "pi", callId: `c${i}`, status: "succeeded" }, SESSION, 2000));
  facts.push(fact("turn.completed", "t", {}, SESSION, 3000));
  events.append(SESSION, StreamVersion.NONE, facts, AT);
  await exporter.execute(NOW);
  assert.deepEqual(sink.batches.map((b) => b.length), [512, 89]);
  assert.equal(new Set(ids(sink.batches)).size, 601);
});

test("con mucho atraso cada pasada envía ≤ 512 y un exportador nuevo (reinicio) sigue donde iba sin duplicar", async () => {
  const { events, store, sink, exporter } = setup();
  session(events, 600);
  await exporter.execute(NOW);
  assert.equal(sink.batches[0].length, 512);
  assert.ok(exporter.lag() > 0);
  const restarted = new TraceExport(events, store, sink, RESOURCE);
  while (restarted.lag() > 0) await restarted.execute(NOW);
  assert.deepEqual(sink.batches.map((b) => b.length), [512, 512, 177]);
  assert.equal(new Set(ids(sink.batches)).size, 600 * 2 + 1);
});

test("los incompletos por tiempo salen aunque no haya eventos nuevos", async () => {
  const { events, sink, exporter } = setup();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 2000)], AT);
  await exporter.execute(NOW);
  assert.equal(sink.batches.length, 0, "no hay nada cerrado todavía");
  assert.equal(exporter.lag(), 0, "pero el estado y el cursor sí avanzan");
  await exporter.execute(Timestamp.fromEpochMs(AT.epochMs() + 600_000));
  assert.deepEqual(sink.batches.map((b) => b.map((s) => [s.name, s.attributes.get("pi_runtime.incomplete")])), [[["tool", true]]]);
});

test("reexportar tras reiniciar el cursor produce los mismos ids; un cursor de otra versión se reinicia solo", async () => {
  const { events, store, sink, exporter } = setup();
  session(events, 3);
  await exporter.execute(NOW);
  const first = ids([sink.batches[0]]).sort();
  store.reset(TraceExport.NAME, TraceExport.VERSION);
  await exporter.execute(NOW);
  store.reset(TraceExport.NAME, 99);
  assert.equal(exporter.lag(), 3 * 3 + 2, "un cursor de otra versión cuenta desde el principio");
  await exporter.execute(NOW);
  assert.deepEqual(ids([sink.batches[1]]).sort(), first);
  assert.deepEqual(ids([sink.batches[2]]).sort(), first);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/TraceExport.test.ts`
Expected: FAIL por `Cannot find module …/ExportResult.ts`.

- [ ] **Step 3: Implementar**

`src/domain/telemetry/ExportResult.ts`:

```ts
type Kind = "ok" | "rejected" | "retryable";

// Resultado de un envío OTLP. `reason` es siempre un código corto (http 503, timeout,
// network ECONNREFUSED…): nunca el endpoint, cabeceras ni el cuerpo de la respuesta.
export class ExportResult {
  readonly kind: Kind; readonly reason: string;
  private constructor(kind: Kind, reason: string) { this.kind = kind; this.reason = reason; }

  static ok(): ExportResult { return new ExportResult("ok", "ok"); }
  static rejected(reason: string): ExportResult { return new ExportResult("rejected", reason); }
  static retryable(reason: string): ExportResult { return new ExportResult("retryable", reason); }

  // 2xx: aceptado; 429 y 5xx: reintento; cualquier otro código: el lote se descarta.
  static ofStatus(status: number): ExportResult {
    if (status >= 200 && status < 300) return ExportResult.ok();
    if (status === 429 || status >= 500) return ExportResult.retryable(`http ${status}`);
    return ExportResult.rejected(`http ${status}`);
  }
}
```

`src/domain/telemetry/OtelKeyValueList.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";

// Formato de OTEL_EXPORTER_OTLP_HEADERS y OTEL_RESOURCE_ATTRIBUTES: "k=v,k2=v2", con los
// valores percent-encoded. Los errores nunca repiten la entrada: puede llevar credenciales.
export class OtelKeyValueList {
  readonly #pairs: ReadonlyMap<string, string>;
  private constructor(pairs: Map<string, string>) { this.#pairs = pairs; }
  static readonly EMPTY = new OtelKeyValueList(new Map());

  static parse(raw: string): OtelKeyValueList {
    if (typeof raw !== "string") throw DomainError.because("key=value list must be a string");
    const pairs = new Map<string, string>();
    raw.split(",").forEach((part, i) => {
      if (part.trim() === "") return;
      const eq = part.indexOf("=");
      const key = eq < 0 ? "" : part.slice(0, eq).trim();
      if (key === "") throw DomainError.because(`malformed key=value list at entry ${i + 1}`);
      let value: string;
      try { value = decodeURIComponent(part.slice(eq + 1).trim()); } catch { throw DomainError.because(`malformed percent-encoding at entry ${i + 1}`); }
      pairs.set(key, value);
    });
    return new OtelKeyValueList(pairs);
  }

  entries(): [string, string][] { return [...this.#pairs]; }
  keys(): string[] { return [...this.#pairs.keys()]; }
  get(key: string): string | null { return this.#pairs.get(key) ?? null; }
  isEmpty(): boolean { return this.#pairs.size === 0; }
}
```

`src/domain/telemetry/TelemetryResource.ts`:

```ts
import type { ProjectId } from "../project/ProjectId.ts";
import { OtelKeyValueList } from "./OtelKeyValueList.ts";
import { SpanAttributes } from "./SpanAttributes.ts";

const KEY = /^[a-z][a-z0-9_.]*$/;
// Claves que identificarían la máquina, la persona o el proceso: nunca salen, aunque vengan en OTEL_RESOURCE_ATTRIBUTES.
const FORBIDDEN = /^(host|os|process|user|enduser|device|container)\./;

// Recurso OTLP: service.name=pi-runtime, service.version y pi_runtime.project (el id con
// hash, nunca la ruta). Respeta OTEL_RESOURCE_ATTRIBUTES salvo claves prohibidas, claves
// no válidas y valores con separadores de ruta; los tres atributos propios no se pisan.
export class TelemetryResource {
  readonly #attributes: SpanAttributes;
  private constructor(attributes: SpanAttributes) { this.#attributes = attributes; }

  static of(version: string, project: ProjectId, extra: OtelKeyValueList = OtelKeyValueList.EMPTY): TelemetryResource {
    const values: Record<string, string> = {};
    for (const [k, v] of extra.entries()) if (KEY.test(k) && !FORBIDDEN.test(k) && !/[\\/]/.test(v)) values[k] = v;
    return new TelemetryResource(SpanAttributes.of({ ...values, "service.name": "pi-runtime", "service.version": version, "pi_runtime.project": project.value }));
  }

  attributes(): SpanAttributes { return this.#attributes; }
}
```

`src/application/ports/TelemetrySink.ts`:

```ts
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { MetricsSnapshot } from "../../domain/telemetry/MetricsSnapshot.ts";
import type { Span } from "../../domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../domain/telemetry/TelemetryResource.ts";

// Destino de la telemetría (OTLP/HTTP en producción). Nunca lanza: un fallo es un ExportResult.
export interface TelemetrySink {
  sendSpans(resource: TelemetryResource, spans: Span[]): Promise<ExportResult>;
  sendMetrics(resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Promise<ExportResult>;
}
```

`src/application/services/ExportBackoff.ts`:

```ts
const BASE_MS = 1_000;
const CAP_MS = 300_000;

// Espera progresiva del exportador OTLP tras un fallo reintentable: 1 s, doblando en
// cada fallo seguido, con tope de 5 min. Inmutable.
export class ExportBackoff {
  readonly #failures: number; readonly #failedAtMs: number;
  private constructor(failures: number, failedAtMs: number) { this.#failures = failures; this.#failedAtMs = failedAtMs; }

  static first(nowMs: number): ExportBackoff { return new ExportBackoff(1, nowMs); }
  failedAgain(nowMs: number): ExportBackoff { return new ExportBackoff(this.#failures + 1, nowMs); }

  failures(): number { return this.#failures; }
  nextAttemptMs(): number { return this.#failedAtMs + Math.min(CAP_MS, BASE_MS * 2 ** Math.min(this.#failures - 1, 16)); }
  isDue(nowMs: number): boolean { return nowMs >= this.nextAttemptMs(); }
}
```

`src/application/use-cases/TraceExport.ts`:

```ts
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../domain/events/ProjectionCursor.ts";
import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { AssemblerState } from "../../domain/telemetry/AssemblerState.ts";
import { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { Span } from "../../domain/telemetry/Span.ts";
import { SpanAssembler } from "../../domain/telemetry/SpanAssembler.ts";
import type { TelemetryResource } from "../../domain/telemetry/TelemetryResource.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import type { TelemetrySink } from "../ports/TelemetrySink.ts";

const BATCH = 512;
const READ = 500;
const STATE_KEY = "assembler";

// Exportador de trazas con cursor propio (`otlp_traces`). Una pasada: parte de una
// instantánea (cursor + estado del ensamblador), ensambla desde el cursor hasta reunir
// 512 spans o llegar al final del log, añade los incompletos por tiempo y envía. Sólo
// tras un 2xx (o un 4xx, que descarta el lote) confirma estado y cursor con el
// compare-and-set de E1. Si otro escritor (un rebuild) movió el cursor, la pasada no
// cuenta y la siguiente parte de la instantánea nueva: los ids son los mismos.
export class TraceExport {
  static readonly NAME = ProjectionName.of("otlp_traces");
  static readonly VERSION = 1;
  readonly #events: EventStore; readonly #store: ProjectionStore; readonly #sink: TelemetrySink; readonly #resource: TelemetryResource;
  constructor(events: EventStore, store: ProjectionStore, sink: TelemetrySink, resource: TelemetryResource) {
    this.#events = events; this.#store = store; this.#sink = sink; this.#resource = resource;
  }

  async execute(now: Timestamp): Promise<ExportResult> {
    const snap = this.#store.snapshot(TraceExport.NAME);
    let cursor = snap.cursor; let saved = snap.state.get(STATE_KEY) as AssemblerState | undefined;
    if (cursor === null || cursor.version !== TraceExport.VERSION) {
      this.#store.reset(TraceExport.NAME, TraceExport.VERSION);
      cursor = ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.START); saved = undefined;
    }
    const assembler = new SpanAssembler(saved ?? SpanAssembler.empty());
    const spans: Span[] = [];
    let position = cursor.position;
    reading: while (spans.length < BATCH) {
      const batch = this.#events.readAll(position, READ);
      if (batch.length === 0) break;
      for (const e of batch) {
        if (spans.length >= BATCH) break reading;
        spans.push(...assembler.feed(e.record));
        position = e.position;
      }
    }
    spans.push(...assembler.expire(now));
    if (spans.length === 0 && position.equals(cursor.position)) return ExportResult.ok();

    let outcome = ExportResult.ok();
    for (let i = 0; i < spans.length; i += BATCH) {
      const result = await this.#sink.sendSpans(this.#resource, spans.slice(i, i + BATCH));
      if (result.kind === "retryable") return result;
      if (result.kind === "rejected") outcome = result;
    }
    this.#store.commit(TraceExport.NAME, cursor, ProjectionCursor.of(TraceExport.VERSION, position), new Map([[STATE_KEY, assembler.state()]]));
    return outcome;
  }

  // Eventos del log que el exportador aún no ha procesado (sin cursor válido, desde el principio).
  lag(): number {
    const c = this.#store.cursor(TraceExport.NAME);
    const done = c === null || c.version !== TraceExport.VERSION ? 0 : c.position.value;
    return Math.max(0, this.#events.lastPosition().value - done);
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %, gates en verde (`TraceExport` no importa `node:*`).

- [ ] **Step 5: Commit**

```bash
git add src tests/support/FakeTelemetrySink.ts tests/unit/domain/telemetry/export.test.ts tests/unit/application/services/ExportBackoff.test.ts tests/unit/application/use-cases/TraceExport.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(telemetría): exportación de trazas con cursor otlp_traces, lotes de 512 y compare-and-set"
```

---

### Task 7: Inicio del acumulado, exportación de métricas y servicio de exportación

**Files:**
- Create: `src/domain/telemetry/TelemetryEpoch.ts`, `src/application/ports/{TelemetryEpochStore,HostLog}.ts`, `src/application/dto/ExporterStatusDto.ts`, `src/application/services/{TelemetryEpochs,ExporterHealth,TelemetryExporter}.ts`, `src/application/use-cases/MetricsExport.ts`, `src/adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts`, `src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts`, `tests/support/ManualClock.ts`
- Modify: `src/application/use-cases/RebuildProjection.ts`
- Test: `tests/unit/application/services/TelemetryEpochs.test.ts`, `tests/unit/application/services/TelemetryExporter.test.ts`, `tests/unit/application/use-cases/RebuildProjection.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6; E1 `Clock`, `SqliteDatabase` (`handle`, tabla `meta`), `ProjectionRunner.rebuild`.
- Produces:
  - `TelemetryEpoch.of(start: Timestamp, projectionVersion: number)`, `TelemetryEpoch.parse(text): TelemetryEpoch | null`, `.start`, `.projectionVersion`, `.text`
  - `interface TelemetryEpochStore { read(): TelemetryEpoch | null; write(epoch: TelemetryEpoch): void }` (SQLite: `meta.telemetry_start`)
  - `interface HostLog { info(message, fields?); warn(message, fields?); error(message, fields?) }` con `fields?: Record<string, string | number | boolean | null>`
  - `type ExporterStatusDto = { state: "disabled" | "ok" | "failing"; lag: number; since: string | null }`
  - `new TelemetryEpochs(store, clock)`, `.current(): TelemetryEpoch`, `.restart(): TelemetryEpoch`
  - `new MetricsExport(read: ReadTelemetryMetrics, epochs: TelemetryEpochs, sink, resource, clock)`, `.execute(): Promise<ExportResult>`
  - `new ExporterHealth(log: HostLog)`, `.record(signal: "traces" | "metrics", result, now)`, `.status(lag): ExporterStatusDto`
  - `new TelemetryExporter(traces: TraceExport, metrics: MetricsExport, health, clock)`, `.tickTraces(): Promise<void>`, `.tickMetrics(): Promise<void>`, `.flush(): Promise<void>`, `.status(): ExporterStatusDto`
  - `new RebuildProjection(runner, store: ProjectionStore | null = null, epochs: TelemetryEpochs | null = null)`
  - `tests/support/ManualClock` (`ms` mutable)

- [ ] **Step 1: Tests que fallan**

`tests/support/ManualClock.ts`:

```ts
import type { Clock } from "../../src/application/ports/Clock.ts";
import { Timestamp } from "../../src/domain/events/Timestamp.ts";

// Reloj que sólo avanza cuando el test cambia `ms`.
export class ManualClock implements Clock {
  ms: number;
  constructor(ms = 0) { this.ms = ms; }
  now(): Timestamp { return Timestamp.fromEpochMs(this.ms); }
}
```

`tests/unit/application/services/TelemetryEpochs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTelemetryEpochStore } from "../../../../src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteTelemetryEpochStore } from "../../../../src/adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { TelemetryEpochs } from "../../../../src/application/services/TelemetryEpochs.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { TelemetryEpoch } from "../../../../src/domain/telemetry/TelemetryEpoch.ts";
import { ManualClock } from "../../../support/ManualClock.ts";

test("el inicio del acumulado se fija una vez, se conserva y se reinicia con otra versión de la proyección o a mano", () => {
  const store = new InMemoryTelemetryEpochStore(); const clock = new ManualClock(1000);
  const epochs = new TelemetryEpochs(store, clock);
  const first = epochs.current();
  assert.deepEqual([first.start.epochMs(), first.projectionVersion], [1000, TelemetryMetricsProjection.VERSION]);
  clock.ms = 5000;
  assert.equal(epochs.current().start.epochMs(), 1000);
  store.write(TelemetryEpoch.of(Timestamp.fromEpochMs(10), 99));
  assert.equal(epochs.current().start.epochMs(), 5000);
  clock.ms = 7000;
  assert.equal(epochs.restart().start.epochMs(), 7000);
  assert.equal(store.read()?.start.epochMs(), 7000);
});

test("TelemetryEpoch: texto canónico reversible; un valor ilegible cuenta como ausente", () => {
  const e = TelemetryEpoch.of(Timestamp.fromEpochMs(1234), 1);
  assert.equal(e.text, '{"projectionVersion":1,"start":"1970-01-01T00:00:01.234Z"}');
  assert.equal(TelemetryEpoch.parse(e.text)?.start.epochMs(), 1234);
  for (const bad of ["x", "{}", '{"start":"ayer","projectionVersion":1}', '{"start":"1970-01-01T00:00:01.234Z","projectionVersion":0}']) assert.equal(TelemetryEpoch.parse(bad), null, bad);
  assert.throws(() => TelemetryEpoch.of(Timestamp.fromEpochMs(0), 1.5), DomainError);
});

test("SQLite: el inicio vive en meta (telemetry_start) y sobrevive a reabrir el log", () => {
  const file = join(mkdtempSync(join(tmpdir(), "epoch-")), "events.sqlite3");
  let db = SqliteDatabase.open(file);
  assert.equal(new SqliteTelemetryEpochStore(db).read(), null);
  new SqliteTelemetryEpochStore(db).write(TelemetryEpoch.of(Timestamp.fromEpochMs(1234), 1));
  new SqliteTelemetryEpochStore(db).write(TelemetryEpoch.of(Timestamp.fromEpochMs(5678), 1));
  db.close();
  db = SqliteDatabase.open(file);
  assert.equal(new SqliteTelemetryEpochStore(db).read()?.start.epochMs(), 5678);
  db.handle.prepare("UPDATE meta SET value = 'x' WHERE key = 'telemetry_start'").run();
  assert.equal(new SqliteTelemetryEpochStore(db).read(), null);
  db.close();
});
```

`tests/unit/application/services/TelemetryExporter.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../../../../src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import type { HostLog } from "../../../../src/application/ports/HostLog.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ExporterHealth } from "../../../../src/application/services/ExporterHealth.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../../../../src/application/services/TelemetryEpochs.ts";
import { TelemetryExporter } from "../../../../src/application/services/TelemetryExporter.ts";
import { MetricsExport } from "../../../../src/application/use-cases/MetricsExport.ts";
import { ReadTelemetryMetrics } from "../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { TraceExport } from "../../../../src/application/use-cases/TraceExport.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { ExportResult } from "../../../../src/domain/telemetry/ExportResult.ts";
import { TelemetryResource } from "../../../../src/domain/telemetry/TelemetryResource.ts";
import { FakeTelemetrySink } from "../../../support/FakeTelemetrySink.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const RESOURCE = TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"));
const t = (ms: number) => Timestamp.fromEpochMs(ms);

function world() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const sink = new FakeTelemetrySink(); const clock = new ManualClock(0);
  const lines: string[] = [];
  const log: HostLog = { info: (m) => { lines.push(m); }, warn: (m) => { lines.push(m); }, error: (m) => { lines.push(m); } };
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("session.closed", "x", {}, SESSION, 2000)], AT);
  new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
  const metrics = new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock);
  const exporter = new TelemetryExporter(new TraceExport(events, store, sink, RESOURCE), metrics, new ExporterHealth(log), clock);
  return { events, store, sink, clock, lines, metrics, exporter };
}

test("métricas: snapshot acumulado desde el inicio del acumulado; sin series no se envía nada", async () => {
  const { sink, clock, metrics } = world();
  const empty = new MetricsExport(new ReadTelemetryMetrics(new InMemoryEventStore(), new InMemoryProjectionStore()), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock);
  assert.equal((await empty.execute()).kind, "ok");
  assert.equal(sink.metrics.length, 0);
  clock.ms = 20_000; await metrics.execute();
  clock.ms = 35_000; await metrics.execute();
  assert.deepEqual(sink.metrics.map((m) => [m.start.epochMs(), m.at.epochMs()]), [[20_000, 20_000], [20_000, 35_000]]);
  assert.deepEqual(sink.metrics[1].snapshot.points().map((p) => p.key.text), ["counter|pi_runtime_sessions_total|event=closed", "counter|pi_runtime_sessions_total|event=opened"]);
});

test("salud del exportador: una línea por cambio de estado y el estado para /underpass-status", () => {
  const lines: string[] = [];
  const log: HostLog = { info: (m, f) => { lines.push(`info ${m} ${JSON.stringify(f ?? {})}`); }, warn: (m, f) => { lines.push(`warn ${m} ${JSON.stringify(f ?? {})}`); }, error: (m) => { lines.push(`error ${m}`); } };
  const h = new ExporterHealth(log);
  assert.deepEqual(h.status(3), { state: "ok", lag: 3, since: null });
  h.record("traces", ExportResult.retryable("http 503"), t(1000));
  h.record("traces", ExportResult.retryable("http 503"), t(2000));
  h.record("traces", ExportResult.retryable("network ECONNREFUSED"), t(3000));
  assert.deepEqual(h.status(7), { state: "failing", lag: 7, since: "1970-01-01T00:00:01.000Z" });
  h.record("metrics", ExportResult.ok(), t(3500));
  assert.equal(h.status(7).state, "failing", "las métricas no tapan el fallo de las trazas");
  h.record("traces", ExportResult.ok(), t(4000));
  h.record("traces", ExportResult.ok(), t(5000));
  h.record("traces", ExportResult.rejected("http 400"), t(6000));
  h.record("traces", ExportResult.rejected("http 400"), t(7000));
  assert.deepEqual(h.status(0), { state: "ok", lag: 0, since: null });
  assert.deepEqual(lines, [
    'warn otlp export failing; retrying with backoff {"signal":"traces","reason":"http 503"}',
    'warn otlp export failing; retrying with backoff {"signal":"traces","reason":"network ECONNREFUSED"}',
    'info otlp exporter recovered {"signal":"traces","failing_since":"1970-01-01T00:00:01.000Z"}',
    'warn otlp batch rejected and dropped {"signal":"traces","reason":"http 400"}',
  ]);
});

test("trazas: tras un fallo reintentable respeta la espera (1 s, luego 2 s) y se recupera", async () => {
  const { sink, clock, exporter } = world();
  sink.results.push(ExportResult.retryable("http 503"), ExportResult.retryable("http 503"));
  await exporter.tickTraces();
  assert.deepEqual(exporter.status(), { state: "failing", lag: 2, since: "1970-01-01T00:00:00.000Z" });
  clock.ms = 999; await exporter.tickTraces();
  assert.equal(sink.batches.length, 1, "antes de 1 s no se reintenta");
  clock.ms = 1000; await exporter.tickTraces();
  assert.equal(sink.batches.length, 2);
  clock.ms = 2999; await exporter.tickTraces();
  assert.equal(sink.batches.length, 2, "la segunda espera es de 2 s");
  clock.ms = 3000; await exporter.tickTraces();
  assert.equal(sink.batches.length, 3);
  assert.deepEqual(exporter.status(), { state: "ok", lag: 0, since: null });
});

test("una sola pasada a la vez; flush espera a la que está en vuelo y hace una última de trazas y métricas", async () => {
  const { sink, exporter } = world();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const original = sink.sendSpans.bind(sink);
  sink.sendSpans = async (r, s) => { await gate; return original(r, s); };
  const a = exporter.tickTraces(); const b = exporter.tickTraces();
  assert.equal(a, b, "la segunda llamada devuelve la pasada en vuelo");
  release(); await a;
  assert.equal(sink.batches.length, 1);
  await exporter.flush();
  assert.equal(sink.batches.length, 1, "nada nuevo: flush no reenvía");
  assert.equal(sink.metrics.length, 1, "flush manda también el snapshot de métricas");
});

test("métricas: un envío fallido no se encola; el siguiente manda el snapshot nuevo", async () => {
  const { sink, exporter, lines } = world();
  sink.results.push(ExportResult.retryable("timeout"));
  await exporter.tickMetrics();
  await exporter.tickMetrics();
  assert.equal(sink.metrics.length, 2);
  assert.deepEqual(lines, ["otlp export failing; retrying with backoff", "otlp exporter recovered"]);
});

test("un error inesperado del exportador nunca sale: cuenta como fallo reintentable", async () => {
  const { sink, exporter } = world();
  sink.sendSpans = async () => { throw new TypeError("boom"); };
  await exporter.tickTraces();
  assert.equal(exporter.status().state, "failing");
});

test("con atraso encadena pasadas en el mismo tick hasta ponerse al día", async () => {
  const { events, sink, exporter } = world();
  const s2 = StreamId.session(SessionId.of("s2"));
  const facts = [fact("session.opened", "o", {}, s2, 1000)];
  for (let i = 0; i < 600; i++) facts.push(fact("turn.completed", `t${i}`, {}, s2, 2000));
  events.append(s2, StreamVersion.NONE, facts, AT);
  await exporter.tickTraces();
  assert.equal(exporter.status().lag, 0);
  assert.deepEqual(sink.batches.map((b) => b.length), [512, 89]);
});
```

`tests/unit/application/use-cases/RebuildProjection.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../../../../src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../../../../src/application/services/TelemetryEpochs.ts";
import { RebuildProjection } from "../../../../src/application/use-cases/RebuildProjection.ts";
import { TraceExport } from "../../../../src/application/use-cases/TraceExport.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../../src/domain/events/ProjectionCursor.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

test("rebuild otlp_traces vuelve su cursor a 0 (reexportación); rebuild telemetry_metrics reinicia el inicio del acumulado", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const clock = new ManualClock(1000);
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
  const runner = new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]);
  runner.runOnce();
  const epochStore = new InMemoryTelemetryEpochStore(); const epochs = new TelemetryEpochs(epochStore, clock);
  epochs.current();
  store.commit(TraceExport.NAME, ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.START), ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.of(1)), new Map([["assembler", { sessions: {}, host: null }]]));
  const rebuild = new RebuildProjection(runner, store, epochs);
  rebuild.execute(TraceExport.NAME);
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 0);
  assert.deepEqual([...store.load(TraceExport.NAME).keys()], []);
  clock.ms = 9000;
  rebuild.execute(TelemetryMetricsProjection.NAME);
  assert.equal(epochStore.read()?.start.epochMs(), 9000);
  assert.equal(store.cursor(TelemetryMetricsProjection.NAME)?.position.value, 1);
  assert.throws(() => new RebuildProjection(runner).execute(TraceExport.NAME), /unknown projection otlp_traces/);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/services/TelemetryExporter.test.ts`
Expected: FAIL por `Cannot find module …/InMemoryTelemetryEpochStore.ts`.

- [ ] **Step 3: Implementar**

`src/domain/telemetry/TelemetryEpoch.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { CanonicalJson } from "../shared/CanonicalJson.ts";
import { Timestamp } from "../events/Timestamp.ts";

// Inicio del acumulado de las métricas (startTimeUnixNano de OTLP) y la versión de
// `telemetry_metrics` con la que se fijó: otra versión implica otro acumulado.
export class TelemetryEpoch {
  readonly start: Timestamp; readonly projectionVersion: number;
  private constructor(start: Timestamp, projectionVersion: number) { this.start = start; this.projectionVersion = projectionVersion; }

  static of(start: Timestamp, projectionVersion: number): TelemetryEpoch {
    if (!Number.isInteger(projectionVersion) || projectionVersion < 1) throw DomainError.because(`invalid projection version ${projectionVersion}`);
    return new TelemetryEpoch(start, projectionVersion);
  }

  // Tolerante: un valor ilegible cuenta como ausente (se fijará uno nuevo).
  static parse(text: string): TelemetryEpoch | null {
    try {
      const o = JSON.parse(text) as { start?: unknown; projectionVersion?: unknown };
      return TelemetryEpoch.of(Timestamp.parse(o.start as string), o.projectionVersion as number);
    } catch { return null; }
  }

  get text(): string { return CanonicalJson.of({ start: this.start.value, projectionVersion: this.projectionVersion }).text; }
}
```

`src/application/ports/TelemetryEpochStore.ts`:

```ts
import type { TelemetryEpoch } from "../../domain/telemetry/TelemetryEpoch.ts";

// Dónde vive el inicio del acumulado (en SQLite, `meta.telemetry_start`): sobrevive a los reinicios del host.
export interface TelemetryEpochStore {
  read(): TelemetryEpoch | null;
  write(epoch: TelemetryEpoch): void;
}
```

`src/application/ports/HostLog.ts`:

```ts
// Log del host (JSON por líneas). Los campos son metadatos: nunca texto de prompts,
// argumentos o salidas, ni cabeceras OTLP. `trace_id` y `span_id`, si vienen como texto,
// van a la raíz de la línea.
export interface HostLog {
  info(message: string, fields?: Record<string, string | number | boolean | null>): void;
  warn(message: string, fields?: Record<string, string | number | boolean | null>): void;
  error(message: string, fields?: Record<string, string | number | boolean | null>): void;
}
```

`src/application/dto/ExporterStatusDto.ts`:

```ts
// Estado del exportador OTLP para /underpass-status: lag en eventos del log sin exportar; since, desde cuándo falla.
export type ExporterStatusDto = { state: "disabled" | "ok" | "failing"; lag: number; since: string | null };
```

`src/application/services/TelemetryEpochs.ts`:

```ts
import { TelemetryEpoch } from "../../domain/telemetry/TelemetryEpoch.ts";
import type { Clock } from "../ports/Clock.ts";
import type { TelemetryEpochStore } from "../ports/TelemetryEpochStore.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";

// Se fija la primera vez que se pide y se conserva. Una versión distinta de
// `telemetry_metrics` (el runner la reconstruye) o un `events rebuild telemetry_metrics`
// lo reinician: OTLP lo ve como un reinicio de contador (otro startTimeUnixNano).
export class TelemetryEpochs {
  readonly #store: TelemetryEpochStore; readonly #clock: Clock;
  constructor(store: TelemetryEpochStore, clock: Clock) { this.#store = store; this.#clock = clock; }

  current(): TelemetryEpoch {
    const epoch = this.#store.read();
    return epoch !== null && epoch.projectionVersion === TelemetryMetricsProjection.VERSION ? epoch : this.restart();
  }

  restart(): TelemetryEpoch {
    const epoch = TelemetryEpoch.of(this.#clock.now(), TelemetryMetricsProjection.VERSION);
    this.#store.write(epoch);
    return epoch;
  }
}
```

`src/application/use-cases/MetricsExport.ts`:

```ts
import { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { TelemetryResource } from "../../domain/telemetry/TelemetryResource.ts";
import type { Clock } from "../ports/Clock.ts";
import type { TelemetrySink } from "../ports/TelemetrySink.ts";
import type { TelemetryEpochs } from "../services/TelemetryEpochs.ts";
import type { ReadTelemetryMetrics } from "./ReadTelemetryMetrics.ts";

// Snapshot acumulado (CUMULATIVE) desde el inicio del acumulado. Sin cola: si un envío
// falla, el siguiente snapshot lo cubre.
export class MetricsExport {
  readonly #read: ReadTelemetryMetrics; readonly #epochs: TelemetryEpochs; readonly #sink: TelemetrySink; readonly #resource: TelemetryResource; readonly #clock: Clock;
  constructor(read: ReadTelemetryMetrics, epochs: TelemetryEpochs, sink: TelemetrySink, resource: TelemetryResource, clock: Clock) {
    this.#read = read; this.#epochs = epochs; this.#sink = sink; this.#resource = resource; this.#clock = clock;
  }

  async execute(): Promise<ExportResult> {
    const epoch = this.#epochs.current();
    const snapshot = this.#read.execute();
    if (snapshot.isEmpty()) return ExportResult.ok();
    return this.#sink.sendMetrics(this.#resource, snapshot, epoch.start, this.#clock.now());
  }
}
```

`src/application/services/ExporterHealth.ts`:

```ts
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { ExporterStatusDto } from "../dto/ExporterStatusDto.ts";
import type { HostLog } from "../ports/HostLog.ts";

type Signal = "traces" | "metrics";

// Estado del exportador por señal. Deja como mucho una línea por cambio de estado: el
// primer fallo (o un motivo nuevo), la recuperación y cada motivo de descarte distinto.
// Un descarte (4xx) no es un fallo: el colector responde.
export class ExporterHealth {
  readonly #log: HostLog;
  readonly #failingSince = new Map<Signal, Timestamp>();
  readonly #last = new Map<Signal, string>();
  constructor(log: HostLog) { this.#log = log; }

  record(signal: Signal, result: ExportResult, now: Timestamp): void {
    if (result.kind === "ok") {
      const since = this.#failingSince.get(signal);
      if (since !== undefined) this.#log.info("otlp exporter recovered", { signal, failing_since: since.value });
      this.#failingSince.delete(signal); this.#last.delete(signal);
      return;
    }
    if (result.kind === "retryable") { if (!this.#failingSince.has(signal)) this.#failingSince.set(signal, now); }
    else this.#failingSince.delete(signal);
    const state = `${result.kind}:${result.reason}`;
    if (this.#last.get(signal) === state) return;
    this.#last.set(signal, state);
    if (result.kind === "rejected") this.#log.warn("otlp batch rejected and dropped", { signal, reason: result.reason });
    else this.#log.warn("otlp export failing; retrying with backoff", { signal, reason: result.reason });
  }

  status(lag: number): ExporterStatusDto {
    const since = [...this.#failingSince.values()].sort((a, b) => a.epochMs() - b.epochMs())[0];
    return since === undefined ? { state: "ok", lag, since: null } : { state: "failing", lag, since: since.value };
  }
}
```

`src/application/services/TelemetryExporter.ts`:

```ts
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { ExporterStatusDto } from "../dto/ExporterStatusDto.ts";
import type { Clock } from "../ports/Clock.ts";
import type { MetricsExport } from "../use-cases/MetricsExport.ts";
import type { TraceExport } from "../use-cases/TraceExport.ts";
import { ExportBackoff } from "./ExportBackoff.ts";
import type { ExporterHealth } from "./ExporterHealth.ts";

const MAX_ROUNDS = 20;

// Bucle de exportación del host. Nunca lanza ni bloquea: cada tick es una promesa que el
// host no espera; una segunda llamada con otra en vuelo devuelve la misma. Tras un fallo
// reintentable de las trazas espera (1 s doblando hasta 5 min); con atraso encadena
// pasadas (hasta MAX_ROUNDS) en el mismo tick. Las métricas no tienen espera ni cola.
export class TelemetryExporter {
  readonly #traces: TraceExport; readonly #metrics: MetricsExport; readonly #health: ExporterHealth; readonly #clock: Clock;
  #backoff: ExportBackoff | null = null;
  #traceRun: Promise<void> | null = null;
  #metricsRun: Promise<void> | null = null;

  constructor(traces: TraceExport, metrics: MetricsExport, health: ExporterHealth, clock: Clock) {
    this.#traces = traces; this.#metrics = metrics; this.#health = health; this.#clock = clock;
  }

  tickTraces(): Promise<void> {
    if (this.#traceRun !== null) return this.#traceRun;
    const now = this.#clock.now();
    if (this.#backoff !== null && !this.#backoff.isDue(now.epochMs())) return Promise.resolve();
    const run = this.#runTraces(now).finally(() => { this.#traceRun = null; });
    this.#traceRun = run;
    return run;
  }

  tickMetrics(): Promise<void> {
    if (this.#metricsRun !== null) return this.#metricsRun;
    const run = TelemetryExporter.#safely(() => this.#metrics.execute())
      .then((result) => { this.#health.record("metrics", result, this.#clock.now()); })
      .finally(() => { this.#metricsRun = null; });
    this.#metricsRun = run;
    return run;
  }

  // Para el apagado del host: espera lo que esté en vuelo y hace una última pasada de cada señal.
  async flush(): Promise<void> {
    await this.#traceRun; await this.tickTraces();
    await this.#metricsRun; await this.tickMetrics();
  }

  status(): ExporterStatusDto { return this.#health.status(this.#lag()); }

  async #runTraces(now: Timestamp): Promise<void> {
    let result = await TelemetryExporter.#safely(() => this.#traces.execute(now));
    for (let round = 1; round < MAX_ROUNDS && result.kind !== "retryable" && this.#lag() > 0; round++) {
      result = await TelemetryExporter.#safely(() => this.#traces.execute(this.#clock.now()));
    }
    this.#health.record("traces", result, now);
    this.#backoff = result.kind !== "retryable" ? null : this.#backoff === null ? ExportBackoff.first(now.epochMs()) : this.#backoff.failedAgain(now.epochMs());
  }

  #lag(): number { try { return this.#traces.lag(); } catch { return 0; } }

  // Un error inesperado cuenta como fallo reintentable; sólo se guarda su tipo (el mensaje podría llevar rutas).
  static async #safely(run: () => Promise<ExportResult>): Promise<ExportResult> {
    try { return await run(); } catch (e) { return ExportResult.retryable(`internal ${e instanceof Error ? e.name : "error"}`); }
  }
}
```

`src/adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts`:

```ts
import type { TelemetryEpochStore } from "../../../application/ports/TelemetryEpochStore.ts";
import { TelemetryEpoch } from "../../../domain/telemetry/TelemetryEpoch.ts";
import type { SqliteDatabase } from "./SqliteDatabase.ts";

const KEY = "telemetry_start";

export class SqliteTelemetryEpochStore implements TelemetryEpochStore {
  readonly #db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.#db = db; }

  read(): TelemetryEpoch | null {
    const row = this.#db.handle.prepare("SELECT value FROM meta WHERE key = ?").get(KEY) as { value?: unknown } | undefined;
    return row === undefined ? null : TelemetryEpoch.parse(String(row.value));
  }

  write(epoch: TelemetryEpoch): void {
    this.#db.handle.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, epoch.text);
  }
}
```

`src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts`:

```ts
import type { TelemetryEpochStore } from "../../../application/ports/TelemetryEpochStore.ts";
import type { TelemetryEpoch } from "../../../domain/telemetry/TelemetryEpoch.ts";

export class InMemoryTelemetryEpochStore implements TelemetryEpochStore {
  #epoch: TelemetryEpoch | null = null;
  read(): TelemetryEpoch | null { return this.#epoch; }
  write(epoch: TelemetryEpoch): void { this.#epoch = epoch; }
}
```

`src/application/use-cases/RebuildProjection.ts` (contenido completo):

```ts
import type { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";
import type { ProjectionRunner } from "../services/ProjectionRunner.ts";
import type { TelemetryEpochs } from "../services/TelemetryEpochs.ts";
import { TraceExport } from "./TraceExport.ts";

// `otlp_traces` no es una proyección del runner: reconstruirla es volver su cursor a 0
// para que el exportador del host reexporte (con los mismos ids). Reconstruir
// `telemetry_metrics` reinicia además el inicio del acumulado.
export class RebuildProjection {
  readonly #runner: ProjectionRunner; readonly #store: ProjectionStore | null; readonly #epochs: TelemetryEpochs | null;
  constructor(runner: ProjectionRunner, store: ProjectionStore | null = null, epochs: TelemetryEpochs | null = null) {
    this.#runner = runner; this.#store = store; this.#epochs = epochs;
  }

  execute(name: ProjectionName): void {
    if (name.equals(TraceExport.NAME) && this.#store !== null) { this.#store.reset(TraceExport.NAME, TraceExport.VERSION); return; }
    this.#runner.rebuild(name);
    if (name.equals(TelemetryMetricsProjection.NAME)) this.#epochs?.restart();
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS (incluido `EventLogPortability.test.ts`, que sigue usando `new RebuildProjection(runner)`), cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests/support/ManualClock.ts tests/unit/application
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(telemetría): inicio del acumulado en meta, exportación de métricas y bucle de exportación con retroceso"
```

---

### Task 8: Configuración OTLP, mapeo a OTLP/JSON y `OtlpHttpTelemetrySink` con colector falso

**Files:**
- Create: `src/domain/telemetry/{OtlpEndpoint,OtlpHeaders,OtlpSettings,OtlpConfiguration}.ts`, `src/adapters/outbound/otlp/{OtlpJsonMapper,OtlpHttpTelemetrySink}.ts`
- Test: `tests/unit/domain/telemetry/otlp-configuration.test.ts`, `tests/unit/adapters/outbound/otlp/OtlpJsonMapper.test.ts`, `tests/unit/adapters/outbound/otlp/OtlpHttpTelemetrySink.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
  - `OtlpEndpoint.of(raw)`, `.signalUrl("traces" | "metrics")`, `.isLocal()`, `.describe(): "localhost" | "https"`
  - `OtlpHeaders.parse(raw)`, `OtlpHeaders.NONE`, `.names(): string[]`, `.toRecord()` (sólo para el adaptador HTTP); `toString`/`toJSON` sólo muestran nombres
  - `OtlpSettings.of(endpoint, headers, timeoutMs = 10000)`, `OtlpSettings.timeout(raw?: string): number`, `OtlpSettings.DEFAULT_TIMEOUT_MS`; campos `endpoint`, `headers`, `timeoutMs`
  - `OtlpConfiguration.fromEnvironment({ endpoint?, headers?, timeout? })`, `OtlpConfiguration.DISABLED`; campos `state: "disabled" | "enabled" | "invalid"`, `settings: OtlpSettings | null`, `problem: string | null`
  - `new OtlpJsonMapper(scopeVersion)`, `.traces(resource, spans)`, `.metrics(resource, snapshot, start, at)`
  - `new OtlpHttpTelemetrySink(settings, mapper, fetchImpl = fetch)` implementa `TelemetrySink`

- [ ] **Step 1: Tests que fallan**

`tests/unit/domain/telemetry/otlp-configuration.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { OtlpConfiguration } from "../../../../src/domain/telemetry/OtlpConfiguration.ts";
import { OtlpEndpoint } from "../../../../src/domain/telemetry/OtlpEndpoint.ts";
import { OtlpHeaders } from "../../../../src/domain/telemetry/OtlpHeaders.ts";
import { OtlpSettings } from "../../../../src/domain/telemetry/OtlpSettings.ts";

test("endpoint: https, o http sólo en localhost, 127.0.0.1 o [::1]; sin credenciales, query ni fragmento", () => {
  assert.equal(OtlpEndpoint.of("https://otel.example.com:4318/").signalUrl("traces"), "https://otel.example.com:4318/v1/traces");
  assert.equal(OtlpEndpoint.of("http://localhost:4318").signalUrl("metrics"), "http://localhost:4318/v1/metrics");
  assert.equal(OtlpEndpoint.of("http://127.0.0.1:4318/base").signalUrl("traces"), "http://127.0.0.1:4318/base/v1/traces");
  assert.ok(OtlpEndpoint.of("http://[::1]:4318").isLocal());
  assert.equal(OtlpEndpoint.of("https://otel.example.com").describe(), "https");
  assert.equal(OtlpEndpoint.of("http://localhost:4318").describe(), "localhost");
  for (const bad of ["http://otel.example.com:4318", "ftp://localhost", "not a url", "https://user:pw@otel.example.com", "https://otel.example.com?x=1", "https://otel.example.com#f"]) {
    assert.throws(() => OtlpEndpoint.of(bad), (e: Error) => e instanceof DomainError && !e.message.includes("otel.example.com") && !e.message.includes("pw"), bad);
  }
  assert.throws(() => OtlpEndpoint.of(undefined as never), DomainError);
});

test("cabeceras: nombres en minúscula; los valores sólo para el adaptador HTTP, nunca en texto", () => {
  const h = OtlpHeaders.parse("Authorization=Bearer%20s3cr3t,X-Tenant=acme,content-type=text/plain");
  assert.deepEqual(h.names(), ["authorization", "x-tenant"]);
  assert.deepEqual(h.toRecord(), { authorization: "Bearer s3cr3t", "x-tenant": "acme" });
  assert.equal(String(h), "OtlpHeaders(authorization, x-tenant)");
  assert.equal(JSON.stringify({ h }), '{"h":["authorization","x-tenant"]}');
  assert.throws(() => OtlpHeaders.parse("bad name=s3cr3t"), (e: Error) => e instanceof DomainError && !e.message.includes("s3cr3t"));
  assert.throws(() => OtlpHeaders.parse("a=s3cr3t%0Ay"), (e: Error) => e instanceof DomainError && !e.message.includes("s3cr3t"));
  assert.deepEqual(OtlpHeaders.NONE.names(), []);
});

test("configuración desde el entorno: desactivada sin endpoint, inválida sin repetir la entrada, timeout de 10 s por defecto", () => {
  assert.equal(OtlpConfiguration.fromEnvironment({}).state, "disabled");
  assert.equal(OtlpConfiguration.fromEnvironment({ endpoint: "  " }).state, "disabled");
  assert.equal(OtlpConfiguration.DISABLED.settings, null);
  const ok = OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", headers: "authorization=t0k3n" });
  assert.equal(ok.state, "enabled");
  assert.equal(ok.settings?.timeoutMs, OtlpSettings.DEFAULT_TIMEOUT_MS);
  assert.equal(OtlpSettings.DEFAULT_TIMEOUT_MS, 10_000);
  assert.deepEqual(ok.settings?.headers.names(), ["authorization"]);
  assert.equal(OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", timeout: "2500" }).settings?.timeoutMs, 2500);
  for (const env of [{ endpoint: "http://collector.internal:4318" }, { endpoint: "http://localhost:4318", headers: "t0k3n" }, { endpoint: "http://localhost:4318", timeout: "soon" }, { endpoint: "http://localhost:4318", timeout: "0" }]) {
    const c = OtlpConfiguration.fromEnvironment(env);
    assert.equal(c.state, "invalid");
    assert.equal(c.settings, null);
    assert.ok(c.problem !== null && !c.problem.includes("collector.internal") && !c.problem.includes("t0k3n"), c.problem ?? "");
  }
  assert.throws(() => OtlpSettings.of(OtlpEndpoint.of("http://localhost:1"), OtlpHeaders.NONE, 700_000), DomainError);
});
```

`tests/unit/adapters/outbound/otlp/OtlpJsonMapper.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { OtlpJsonMapper } from "../../../../../src/adapters/outbound/otlp/OtlpJsonMapper.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../../src/domain/events/Timestamp.ts";
import { ProjectId } from "../../../../../src/domain/project/ProjectId.ts";
import { HistogramValue } from "../../../../../src/domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../../../../src/domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../../../../src/domain/telemetry/MetricCatalog.ts";
import type { MetricDescriptor } from "../../../../../src/domain/telemetry/MetricDescriptor.ts";
import { MetricKey } from "../../../../../src/domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../../../../src/domain/telemetry/MetricLabels.ts";
import { MetricPoint } from "../../../../../src/domain/telemetry/MetricPoint.ts";
import { MetricsSnapshot } from "../../../../../src/domain/telemetry/MetricsSnapshot.ts";
import { SpanAssembler } from "../../../../../src/domain/telemetry/SpanAssembler.ts";
import { TelemetryResource } from "../../../../../src/domain/telemetry/TelemetryResource.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

const RESOURCE = TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"));
type J = any;

test("trazas: ExportTraceServiceRequest con ids hex, tiempos en ns como texto, atributos tipados y status", () => {
  const store = new InMemoryEventStore();
  store.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", {}, SESSION, 1000),
    fact("phase.changed", "p", { to: "design" }, SESSION, 1100),
    fact("tool.started", "c1s", { tool: "bash", server: "pi", callId: "c1", argsBytes: 12 }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "bash", server: "pi", callId: "c1", status: "failed", outputBytes: 3 }, SESSION, 2400),
    fact("turn.completed", "t", { cost: 0.5, outcome: "completed", durationMs: 1000 }, SESSION, 3000),
  ], AT);
  const a = new SpanAssembler(SpanAssembler.empty());
  const spans = [...store.readStream(SESSION).flatMap((r) => a.feed(r)), ...a.flush(Timestamp.fromEpochMs(4000))];
  const body = new OtlpJsonMapper("0.1.0").traces(RESOURCE, spans) as J;
  assert.deepEqual(Object.keys(body), ["resourceSpans"]);
  const rs = body.resourceSpans[0];
  assert.deepEqual(rs.resource.attributes, [
    { key: "pi_runtime.project", value: { stringValue: "0123456789abcdef" } },
    { key: "service.name", value: { stringValue: "pi-runtime" } },
    { key: "service.version", value: { stringValue: "0.1.0" } },
  ]);
  assert.deepEqual(rs.scopeSpans[0].scope, { name: "pi-runtime", version: "0.1.0" });
  const out = rs.scopeSpans[0].spans;
  assert.deepEqual(out.map((s: J) => s.name), ["turn", "tool", "session"]);
  const [turn, tool, session] = out;
  assert.deepEqual(Object.keys(tool).sort(), ["attributes", "endTimeUnixNano", "events", "kind", "name", "parentSpanId", "spanId", "startTimeUnixNano", "status", "traceId"]);
  assert.match(tool.traceId, /^[0-9a-f]{32}$/);
  assert.match(tool.spanId, /^[0-9a-f]{16}$/);
  assert.equal(tool.parentSpanId, turn.spanId);
  assert.equal(turn.parentSpanId, session.spanId);
  assert.equal("parentSpanId" in session, false);
  assert.deepEqual([tool.kind, tool.startTimeUnixNano, tool.endTimeUnixNano, tool.status], [1, "2000000000", "2400000000", { code: 2 }]);
  assert.deepEqual(tool.attributes, [
    { key: "pi_runtime.args_bytes", value: { intValue: "12" } },
    { key: "pi_runtime.output_bytes", value: { intValue: "3" } },
    { key: "pi_runtime.server", value: { stringValue: "pi" } },
    { key: "pi_runtime.status", value: { stringValue: "failed" } },
    { key: "pi_runtime.tool", value: { stringValue: "bash" } },
  ]);
  assert.deepEqual(turn.attributes.find((x: J) => x.key === "pi_runtime.cost"), { key: "pi_runtime.cost", value: { doubleValue: 0.5 } });
  assert.deepEqual(session.status, { code: 0 });
  assert.deepEqual(session.events, [{ timeUnixNano: "1100000000", name: "phase.changed", attributes: [{ key: "pi_runtime.phase.to", value: { stringValue: "design" } }] }]);
  assert.deepEqual(session.attributes.find((x: J) => x.key === "pi_runtime.incomplete"), { key: "pi_runtime.incomplete", value: { boolValue: true } });
});

test("métricas: sum CUMULATIVE monótona (asInt o asDouble) e histograma con 12 cubos y 11 límites", () => {
  const key = (d: MetricDescriptor, labels: Record<string, LabelValue>) => MetricKey.of(d, MetricLabels.of(labels));
  const snapshot = MetricsSnapshot.of([
    MetricPoint.counter(key(MetricCatalog.SESSIONS, { event: LabelValue.of("opened") }), 2),
    MetricPoint.counter(key(MetricCatalog.COST, { model: LabelValue.of("m"), provider: LabelValue.of("p") }), 0.75),
    MetricPoint.histogram(key(MetricCatalog.TOOL_DURATION, { server: LabelValue.of("kmp"), tool: LabelValue.of("kmp_ask") }), HistogramValue.EMPTY.observe(40).observe(90_000)),
  ]);
  const body = new OtlpJsonMapper("0.1.0").metrics(RESOURCE, snapshot, Timestamp.fromEpochMs(1000), Timestamp.fromEpochMs(16_000)) as J;
  assert.deepEqual(body.resourceMetrics[0].scopeMetrics[0].scope, { name: "pi-runtime", version: "0.1.0" });
  const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.deepEqual(metrics.map((m: J) => m.name), ["pi_runtime_tool_duration_ms", "pi_runtime_cost_total", "pi_runtime_sessions_total"]);
  const [duration, cost, sessions] = metrics;
  assert.deepEqual(sessions, { name: "pi_runtime_sessions_total", description: "Session lifecycle events.", unit: "", sum: { aggregationTemporality: 2, isMonotonic: true,
    dataPoints: [{ attributes: [{ key: "event", value: { stringValue: "opened" } }], startTimeUnixNano: "1000000000", timeUnixNano: "16000000000", asInt: "2" }] } });
  assert.equal(cost.sum.dataPoints[0].asDouble, 0.75);
  assert.equal("asInt" in cost.sum.dataPoints[0], false);
  assert.equal(duration.histogram.aggregationTemporality, 2);
  assert.deepEqual(duration.histogram.dataPoints[0], {
    attributes: [{ key: "server", value: { stringValue: "kmp" } }, { key: "tool", value: { stringValue: "kmp_ask" } }],
    startTimeUnixNano: "1000000000", timeUnixNano: "16000000000", count: "2", sum: 90_040,
    bucketCounts: ["0", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "1"], explicitBounds: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  });
});
```


`tests/unit/adapters/outbound/otlp/OtlpHttpTelemetrySink.test.ts` (el colector OTLP falso es un `node:http` local del propio test):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../../../../../src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { OtlpHttpTelemetrySink } from "../../../../../src/adapters/outbound/otlp/OtlpHttpTelemetrySink.ts";
import { OtlpJsonMapper } from "../../../../../src/adapters/outbound/otlp/OtlpJsonMapper.ts";
import { SqliteDatabase } from "../../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import type { EventStore } from "../../../../../src/application/ports/EventStore.ts";
import { TelemetryMetricsProjection } from "../../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../../src/application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../../../../../src/application/services/TelemetryEpochs.ts";
import { MetricsExport } from "../../../../../src/application/use-cases/MetricsExport.ts";
import { ReadTelemetryMetrics } from "../../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { RebuildProjection } from "../../../../../src/application/use-cases/RebuildProjection.ts";
import { TraceExport } from "../../../../../src/application/use-cases/TraceExport.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../../src/domain/events/Timestamp.ts";
import { ProjectId } from "../../../../../src/domain/project/ProjectId.ts";
import { ExportResult } from "../../../../../src/domain/telemetry/ExportResult.ts";
import { OtlpConfiguration } from "../../../../../src/domain/telemetry/OtlpConfiguration.ts";
import { TelemetryResource } from "../../../../../src/domain/telemetry/TelemetryResource.ts";
import { ManualClock } from "../../../../support/ManualClock.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

type J = any;
type Hit = { path: string; status: number; headers: IncomingHttpHeaders; body: J };

const RESOURCE = TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"));
const NOW = Timestamp.fromEpochMs(10_000);

async function collector(respond: (path: string, n: number) => number | "hang" = () => 200) {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      const status = respond(req.url ?? "", hits.length);
      if (status === "hang") return;
      hits.push({ path: req.url ?? "", status, headers: req.headers, body: JSON.parse(data) });
      res.writeHead(status, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { hits, url, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const accepted = (hits: Hit[]): J[] => hits.filter((h) => h.status < 300 && h.path === "/v1/traces").flatMap((h) => h.body.resourceSpans[0].scopeSpans[0].spans);
const sinkFor = (url: string, extra: { headers?: string; timeout?: string } = {}) =>
  new OtlpHttpTelemetrySink(OtlpConfiguration.fromEnvironment({ endpoint: url, ...extra }).settings!, new OtlpJsonMapper("0.1.0"));
const world = () => ({ events: new InMemoryEventStore(), store: new InMemoryProjectionStore() });

// Un campo que no es de E1 (`prompt`) con texto y una ruta: el ensamblador nunca lo copia.
function session(events: EventStore, calls = 2): void {
  const facts = [fact("session.opened", "o", { reason: "startup" }, SESSION, 1000)];
  for (let i = 0; i < calls; i++) facts.push(
    fact("tool.started", `c${i}s`, { tool: "kmp_ask", server: "kmp", callId: `c${i}`, prompt: "SECRET-PROMPT /home/u/private" }, SESSION, 2000),
    fact("tool.completed", `c${i}`, { tool: "kmp_ask", server: "kmp", callId: `c${i}`, durationMs: 5, status: "succeeded" }, SESSION, 2005),
    fact("turn.completed", `t${i}`, { durationMs: 10, model: "m", provider: "p" }, SESSION, 2010));
  facts.push(fact("session.closed", "x", {}, SESSION, 3000));
  events.append(SESSION, StreamVersion.NONE, facts, AT);
}

test("trazas y métricas llegan en OTLP/JSON con las cabeceras de OTEL_EXPORTER_OTLP_HEADERS y sin contenido sensible", async () => {
  const c = await collector();
  try {
    const { events, store } = world();
    session(events);
    new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
    const sink = sinkFor(c.url, { headers: "authorization=Bearer%20s3cr3t,x-tenant=acme" });
    const clock = new ManualClock(20_000);
    assert.equal((await new TraceExport(events, store, sink, RESOURCE).execute(NOW)).kind, "ok");
    assert.equal((await new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock).execute()).kind, "ok");
    assert.deepEqual(c.hits.map((h) => h.path), ["/v1/traces", "/v1/metrics"]);
    for (const h of c.hits) {
      assert.equal(h.headers["content-type"], "application/json");
      assert.equal(h.headers.authorization, "Bearer s3cr3t");
      assert.equal(h.headers["x-tenant"], "acme");
    }
    const spans = accepted(c.hits);
    assert.equal(spans.length, 2 * 2 + 1);
    const ids = new Set(spans.map((s) => s.spanId));
    assert.ok(spans.every((s) => s.parentSpanId === undefined || ids.has(s.parentSpanId)), "trazas completas: todo padre existe");
    assert.ok(c.hits[1].body.resourceMetrics[0].scopeMetrics[0].metrics.some((m: J) => m.name === "pi_runtime_tool_invocations_total"));
    const wire = JSON.stringify(c.hits.map((h) => h.body));
    for (const secret of ["SECRET-PROMPT", "/home/u/private", homedir(), "s3cr3t", ...(hostname().length > 3 ? [hostname()] : [])]) assert.equal(wire.includes(secret), false, secret);
  } finally { await c.close(); }
});

test("caída del colector (503) y reintento: el cursor no avanza hasta el 2xx y no hay duplicados aceptados", async () => {
  const c = await collector((_, n) => (n === 0 ? 503 : 200));
  try {
    const { events, store } = world();
    session(events);
    const exporter = new TraceExport(events, store, sinkFor(c.url), RESOURCE);
    assert.deepEqual(await exporter.execute(NOW), ExportResult.retryable("http 503"));
    assert.equal(exporter.lag(), events.lastPosition().value);
    assert.equal((await exporter.execute(NOW)).kind, "ok");
    const spans = accepted(c.hits);
    assert.equal(spans.length, 5);
    assert.equal(new Set(spans.map((s) => s.spanId)).size, 5);
    assert.equal(c.hits[0].body.resourceSpans[0].scopeSpans[0].spans.length, 5, "el intento fallido llevaba el mismo lote");
  } finally { await c.close(); }
});

test("un 4xx se descarta: el cursor avanza y no se reenvía", async () => {
  const c = await collector(() => 400);
  try {
    const { events, store } = world();
    session(events);
    const exporter = new TraceExport(events, store, sinkFor(c.url), RESOURCE);
    const r = await exporter.execute(NOW);
    assert.deepEqual([r.kind, r.reason], ["rejected", "http 400"]);
    assert.equal(exporter.lag(), 0);
    await exporter.execute(NOW);
    assert.equal(c.hits.length, 1);
  } finally { await c.close(); }
});

test("sin colector o sin respuesta: reintentable con un motivo que no nombra el endpoint", async () => {
  const down = await collector(); const url = down.url; await down.close();
  const r = await sinkFor(url).sendSpans(RESOURCE, []);
  assert.equal(r.kind, "retryable");
  assert.match(r.reason, /^network( [A-Z0-9_]+| error)$/);
  assert.equal(r.reason.includes("127.0.0.1"), false);
  const hang = await collector(() => "hang");
  try {
    const t = await sinkFor(hang.url, { timeout: "200" }).sendSpans(RESOURCE, []);
    assert.deepEqual([t.kind, t.reason], ["retryable", "timeout"]);
  } finally { await hang.close(); }
});

test("reexportar (rebuild otlp_traces) manda los mismos ids: el colector no ve spans nuevos", async () => {
  const c = await collector();
  try {
    const { events, store } = world();
    session(events, 3);
    const exporter = new TraceExport(events, store, sinkFor(c.url), RESOURCE);
    await exporter.execute(NOW);
    const first = accepted(c.hits).map((s) => s.spanId).sort();
    new RebuildProjection(new ProjectionRunner(events, store, []), store).execute(TraceExport.NAME);
    while (exporter.lag() > 0) await exporter.execute(NOW);
    const all = accepted(c.hits).map((s) => s.spanId);
    assert.equal(all.length, first.length * 2);
    assert.deepEqual([...new Set(all)].sort(), first);
  } finally { await c.close(); }
});

test("reinicio del host a mitad de lote (SQLite): estado y cursor sobreviven, sin perder ni duplicar spans", async () => {
  const c = await collector();
  const file = join(mkdtempSync(join(tmpdir(), "otlp-")), "events.sqlite3");
  try {
    let db = SqliteDatabase.open(file);
    let events = new SqliteEventStore(db);
    const facts = [fact("session.opened", "o", {}, SESSION, 1000)];
    for (let i = 0; i < 300; i++) facts.push(fact("tool.completed", `c${i}`, { tool: "t", server: "pi", callId: `c${i}`, status: "succeeded" }, SESSION, 2000), fact("turn.completed", `t${i}`, {}, SESSION, 2001));
    facts.push(fact("tool.started", "open1", { tool: "kmp_ask", server: "kmp", callId: "open1" }, SESSION, 5000));
    events.append(SESSION, StreamVersion.NONE, facts, AT);
    await new TraceExport(events, new SqliteProjectionStore(db), sinkFor(c.url), RESOURCE).execute(NOW);
    assert.equal(accepted(c.hits).length, 512);
    db.close(); // el host muere tras el primer lote

    db = SqliteDatabase.open(file); events = new SqliteEventStore(db);
    const exporter = new TraceExport(events, new SqliteProjectionStore(db), sinkFor(c.url), RESOURCE);
    while (exporter.lag() > 0) await exporter.execute(NOW);
    events.append(SESSION, events.head(SESSION)!.version, [fact("tool.completed", "open1c", { tool: "kmp_ask", server: "kmp", callId: "open1", status: "succeeded" }, SESSION, 6000), fact("session.closed", "x", {}, SESSION, 7000)], AT);
    db.close(); // y otra vez con el tool.started pendiente en el estado

    db = SqliteDatabase.open(file); events = new SqliteEventStore(db);
    const again = new TraceExport(events, new SqliteProjectionStore(db), sinkFor(c.url), RESOURCE);
    while (again.lag() > 0) await again.execute(NOW);
    const spans = accepted(c.hits);
    assert.equal(spans.length, 600 + 2);
    assert.equal(new Set(spans.map((s) => s.spanId)).size, spans.length);
    const open = spans.find((s) => s.name === "tool" && s.attributes.some((a: J) => a.key === "pi_runtime.tool" && a.value.stringValue === "kmp_ask"));
    assert.equal(open.startTimeUnixNano, "5000000000", "el tool.started de antes del reinicio sigue en el estado");
    db.close();
  } finally { await c.close(); }
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/outbound/otlp/OtlpHttpTelemetrySink.test.ts`
Expected: FAIL por `Cannot find module …/OtlpHttpTelemetrySink.ts`.

- [ ] **Step 3: Implementar**

`src/domain/telemetry/OtlpEndpoint.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

// OTEL_EXPORTER_OTLP_ENDPOINT. https:// obligatorio salvo en localhost, 127.0.0.1 o [::1].
// Sin credenciales, query ni fragmento. Los errores nunca repiten la URL; `describe` es lo
// único que se muestra (doctor): ni host ni ruta.
export class OtlpEndpoint extends ValueObject<string> {
  private constructor(v: string) { super(v); }

  static of(raw: string): OtlpEndpoint {
    if (typeof raw !== "string") throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must be a string");
    let url: URL;
    try { url = new URL(raw.trim()); } catch { throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL"); }
    if (url.username !== "" || url.password !== "") throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must not embed credentials; use OTEL_EXPORTER_OTLP_HEADERS");
    if (url.search !== "" || url.hash !== "") throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must not have a query or fragment");
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL.has(url.hostname));
    if (!secure) throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must use https:// outside localhost, 127.0.0.1 and [::1]");
    return new OtlpEndpoint(url.href.replace(/\/+$/, ""));
  }

  signalUrl(signal: "traces" | "metrics"): string { return `${this.value}/v1/${signal}`; }
  isLocal(): boolean { return LOCAL.has(new URL(this.value).hostname); }
  describe(): string { return this.isLocal() ? "localhost" : "https"; }
}
```

`src/domain/telemetry/OtlpHeaders.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { OtelKeyValueList } from "./OtelKeyValueList.ts";

const NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

// OTEL_EXPORTER_OTLP_HEADERS. Sólo los nombres se pueden mostrar (doctor); los valores
// sólo salen hacia el adaptador HTTP. toString y toJSON enseñan nombres, nunca valores.
// content-type lo fija el exportador y se ignora aquí.
export class OtlpHeaders {
  readonly #values: ReadonlyMap<string, string>;
  private constructor(values: Map<string, string>) { this.#values = values; }
  static readonly NONE = new OtlpHeaders(new Map());

  static parse(raw: string): OtlpHeaders {
    const values = new Map<string, string>();
    for (const [key, value] of OtelKeyValueList.parse(raw).entries()) {
      if (!NAME.test(key)) throw DomainError.because("OTEL_EXPORTER_OTLP_HEADERS has an invalid header name");
      const name = key.toLowerCase();
      if (/[\r\n]/.test(value)) throw DomainError.because(`OTEL_EXPORTER_OTLP_HEADERS value for ${name} has a line break`);
      if (name !== "content-type") values.set(name, value);
    }
    return new OtlpHeaders(values);
  }

  names(): string[] { return [...this.#values.keys()].sort(); }
  toRecord(): Record<string, string> { return Object.fromEntries(this.#values); }
  toString(): string { return `OtlpHeaders(${this.names().join(", ")})`; }
  toJSON(): string[] { return this.names(); }
}
```

`src/domain/telemetry/OtlpSettings.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { OtlpEndpoint } from "./OtlpEndpoint.ts";
import type { OtlpHeaders } from "./OtlpHeaders.ts";

const TIMEOUT = "OTEL_EXPORTER_OTLP_TIMEOUT must be an integer between 1 and 600000 (ms)";

export class OtlpSettings {
  static readonly DEFAULT_TIMEOUT_MS = 10_000;
  readonly endpoint: OtlpEndpoint; readonly headers: OtlpHeaders; readonly timeoutMs: number;
  private constructor(endpoint: OtlpEndpoint, headers: OtlpHeaders, timeoutMs: number) { this.endpoint = endpoint; this.headers = headers; this.timeoutMs = timeoutMs; }

  static of(endpoint: OtlpEndpoint, headers: OtlpHeaders, timeoutMs: number = OtlpSettings.DEFAULT_TIMEOUT_MS): OtlpSettings {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw DomainError.because(TIMEOUT);
    return new OtlpSettings(endpoint, headers, timeoutMs);
  }

  // OTEL_EXPORTER_OTLP_TIMEOUT en ms; vacío o ausente, el valor por defecto.
  static timeout(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === "") return OtlpSettings.DEFAULT_TIMEOUT_MS;
    if (!/^\d+$/.test(raw.trim())) throw DomainError.because(TIMEOUT);
    return Number(raw.trim());
  }
}
```

`src/domain/telemetry/OtlpConfiguration.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { OtlpEndpoint } from "./OtlpEndpoint.ts";
import { OtlpHeaders } from "./OtlpHeaders.ts";
import { OtlpSettings } from "./OtlpSettings.ts";

type State = "disabled" | "enabled" | "invalid";

// La exportación sólo se activa con OTEL_EXPORTER_OTLP_ENDPOINT. Una configuración
// inválida desactiva la exportación y se explica (en doctor y una vez en host.log) con
// un mensaje propio que nunca repite el endpoint ni las cabeceras.
export class OtlpConfiguration {
  readonly state: State; readonly settings: OtlpSettings | null; readonly problem: string | null;
  private constructor(state: State, settings: OtlpSettings | null, problem: string | null) { this.state = state; this.settings = settings; this.problem = problem; }
  static readonly DISABLED = new OtlpConfiguration("disabled", null, null);

  static fromEnvironment(v: { endpoint?: string; headers?: string; timeout?: string }): OtlpConfiguration {
    if (v.endpoint === undefined || v.endpoint.trim() === "") return OtlpConfiguration.DISABLED;
    try {
      const headers = v.headers === undefined || v.headers.trim() === "" ? OtlpHeaders.NONE : OtlpHeaders.parse(v.headers);
      return new OtlpConfiguration("enabled", OtlpSettings.of(OtlpEndpoint.of(v.endpoint), headers, OtlpSettings.timeout(v.timeout)), null);
    } catch (e) {
      return new OtlpConfiguration("invalid", null, e instanceof DomainError ? e.message : "invalid OTLP configuration");
    }
  }
}
```

`src/adapters/outbound/otlp/OtlpJsonMapper.ts`:

```ts
import type { Timestamp } from "../../../domain/events/Timestamp.ts";
import { HistogramValue } from "../../../domain/telemetry/HistogramValue.ts";
import type { MetricsSnapshot } from "../../../domain/telemetry/MetricsSnapshot.ts";
import type { Span } from "../../../domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../../domain/telemetry/TelemetryResource.ts";

type AnyValue = { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number };
type KeyValue = { key: string; value: AnyValue };

const SCOPE = "pi-runtime";
const SPAN_KIND_INTERNAL = 1;
const STATUS_CODE_UNSET = 0;
const STATUS_CODE_ERROR = 2;
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
const nanos = (t: Timestamp) => (BigInt(t.epochMs()) * 1_000_000n).toString();

// ExportTraceServiceRequest y ExportMetricsServiceRequest en OTLP/JSON (mapeo JSON de
// proto3): traceId/spanId en hex, enteros de 64 bits y tiempos como texto, enums como
// número. Las métricas llevan el nombre exacto del catálogo y `unit` vacía, para que un
// receptor Prometheus no añada sufijos y los nombres coincidan con reglas y dashboard.
export class OtlpJsonMapper {
  readonly #version: string;
  constructor(scopeVersion: string) { this.#version = scopeVersion; }

  traces(resource: TelemetryResource, spans: Span[]): Record<string, unknown> {
    return { resourceSpans: [{
      resource: { attributes: OtlpJsonMapper.#attributes(resource.attributes().entries()) },
      scopeSpans: [{ scope: { name: SCOPE, version: this.#version }, spans: spans.map((s) => ({
        traceId: s.traceId.value, spanId: s.spanId.value, ...(s.parentId === null ? {} : { parentSpanId: s.parentId.value }),
        name: s.name, kind: SPAN_KIND_INTERNAL, startTimeUnixNano: nanos(s.start), endTimeUnixNano: nanos(s.end),
        attributes: OtlpJsonMapper.#attributes(s.attributes.entries()),
        events: s.events.map((e) => ({ timeUnixNano: nanos(e.at), name: e.name, attributes: OtlpJsonMapper.#attributes(e.attributes.entries()) })),
        status: { code: s.status.isError() ? STATUS_CODE_ERROR : STATUS_CODE_UNSET },
      })) }],
    }] };
  }

  metrics(resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Record<string, unknown> {
    const point = (labels: [string, string][]) => ({ attributes: labels.map(([key, v]) => ({ key, value: { stringValue: v } })), startTimeUnixNano: nanos(start), timeUnixNano: nanos(at) });
    return { resourceMetrics: [{
      resource: { attributes: OtlpJsonMapper.#attributes(resource.attributes().entries()) },
      scopeMetrics: [{ scope: { name: SCOPE, version: this.#version }, metrics: snapshot.byDescriptor().map(({ descriptor: d, points }) => d.kind === "histogram"
        ? { name: d.name, description: d.help, unit: "", histogram: { aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE, dataPoints: points.map((p) => {
            const h = p.histogram as HistogramValue;
            return { ...point(p.key.labels.entries()), count: String(h.count), sum: h.sum, bucketCounts: h.bucketCounts().map(String), explicitBounds: [...HistogramValue.BOUNDS] };
          }) } }
        : { name: d.name, description: d.help, unit: "", sum: { aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE, isMonotonic: true, dataPoints: points.map((p) => ({
            ...point(p.key.labels.entries()), ...(d.integer ? { asInt: String(Math.round(p.value ?? 0)) } : { asDouble: p.value ?? 0 }),
          })) } }) }],
    }] };
  }

  static #attributes(entries: [string, string | number | boolean][]): KeyValue[] {
    return entries.map(([key, v]) => ({ key, value: typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { boolValue: v } : Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } }));
  }
}
```

`src/adapters/outbound/otlp/OtlpHttpTelemetrySink.ts`:

```ts
import type { TelemetrySink } from "../../../application/ports/TelemetrySink.ts";
import type { Timestamp } from "../../../domain/events/Timestamp.ts";
import { ExportResult } from "../../../domain/telemetry/ExportResult.ts";
import type { MetricsSnapshot } from "../../../domain/telemetry/MetricsSnapshot.ts";
import type { OtlpSettings } from "../../../domain/telemetry/OtlpSettings.ts";
import type { Span } from "../../../domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../../domain/telemetry/TelemetryResource.ts";
import type { OtlpJsonMapper } from "./OtlpJsonMapper.ts";

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

// POST OTLP/HTTP JSON con `fetch` nativo y OTEL_EXPORTER_OTLP_TIMEOUT. Nunca lanza. El
// cuerpo de la respuesta se descarta sin leerlo en ningún log.
export class OtlpHttpTelemetrySink implements TelemetrySink {
  readonly #settings: OtlpSettings; readonly #mapper: OtlpJsonMapper; readonly #fetch: Fetch;
  constructor(settings: OtlpSettings, mapper: OtlpJsonMapper, fetchImpl: Fetch = (url, init) => fetch(url, init)) {
    this.#settings = settings; this.#mapper = mapper; this.#fetch = fetchImpl;
  }

  sendSpans(resource: TelemetryResource, spans: Span[]): Promise<ExportResult> { return this.#post("traces", this.#mapper.traces(resource, spans)); }
  sendMetrics(resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Promise<ExportResult> {
    return this.#post("metrics", this.#mapper.metrics(resource, snapshot, start, at));
  }

  async #post(kind: "traces" | "metrics", body: Record<string, unknown>): Promise<ExportResult> {
    try {
      const res = await this.#fetch(this.#settings.endpoint.signalUrl(kind), {
        method: "POST", headers: { ...this.#settings.headers.toRecord(), "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.#settings.timeoutMs),
      });
      await res.arrayBuffer().catch(() => undefined);
      return ExportResult.ofStatus(res.status);
    } catch (e) {
      return ExportResult.retryable(OtlpHttpTelemetrySink.#reason(e));
    }
  }

  // Sólo un código: el mensaje de fetch puede nombrar el host del endpoint.
  static #reason(e: unknown): string {
    const err = e as { name?: unknown; cause?: { code?: unknown } } | null;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
    const code = err?.cause?.code;
    return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? `network ${code}` : "network error";
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %; ningún test deja un servidor HTTP abierto (el proceso de test termina).

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/domain/telemetry/otlp-configuration.test.ts tests/unit/adapters/outbound/otlp
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(otlp): configuración desde el entorno, mapeo OTLP/JSON y exportador HTTP con colector falso"
```

---

### Task 9: Texto Prometheus y `underpass metrics`

**Files:**
- Create: `src/adapters/inbound/cli/{PrometheusTextRenderer,MetricsCli}.ts`
- Modify: `src/adapters/inbound/cli/UnderpassCli.ts`, `src/composition/EventLogComposition.ts`, `src/composition/CliComposition.ts`
- Test: `tests/unit/adapters/inbound/cli/PrometheusTextRenderer.test.ts`, `tests/unit/adapters/inbound/cli/MetricsCli.test.ts`; añadir casos a `tests/unit/adapters/inbound/cli/UnderpassCli.test.ts`, `tests/unit/composition/CliComposition.test.ts` y `tests/unit/composition/EventLogComposition.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, 7 (`TelemetryEpochs`, `InMemoryTelemetryEpochStore`, `SqliteTelemetryEpochStore`, `RebuildProjection(runner, store, epochs)`); E1 `ProjectionLag.execute(only?)`, `LazyEventStore`, `LazyProjectionStore`.
- Produces:
  - `new PrometheusTextRenderer().render(snapshot: MetricsSnapshot): string`
  - `new MetricsCli({ read: ReadTelemetryMetrics, lag: ProjectionLag, print })`, `.run(args): number`
  - `new UnderpassCli(setup, doctor, print, events = null, metrics = null)`; verbo `metrics`
  - `EventLogComposition.metrics(): { run(args: string[]): number }`; las cuatro proyecciones (`session_summary`, `tool_stats`, `telemetry_metrics`, `quality_kpis`) en su lista; `rebuild` con `otlp_traces` y reinicio del acumulado

- [ ] **Step 1: Tests que fallan**

`tests/unit/adapters/inbound/cli/PrometheusTextRenderer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PrometheusTextRenderer } from "../../../../../src/adapters/inbound/cli/PrometheusTextRenderer.ts";
import { HistogramValue } from "../../../../../src/domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../../../../src/domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../../../../src/domain/telemetry/MetricCatalog.ts";
import { MetricKey } from "../../../../../src/domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../../../../src/domain/telemetry/MetricLabels.ts";
import { MetricPoint } from "../../../../../src/domain/telemetry/MetricPoint.ts";
import { MetricsSnapshot } from "../../../../../src/domain/telemetry/MetricsSnapshot.ts";

test("formato de exposición: HELP, TYPE, labels ordenados e histograma con _bucket{le}, _sum y _count", () => {
  const tool = { server: LabelValue.of("kmp"), tool: LabelValue.of("kmp_ask") };
  const snapshot = MetricsSnapshot.of([
    MetricPoint.counter(MetricKey.of(MetricCatalog.COST, MetricLabels.of({ provider: LabelValue.of("p1"), model: LabelValue.of("m1") })), 0.75),
    MetricPoint.histogram(MetricKey.of(MetricCatalog.TOOL_DURATION, MetricLabels.of(tool)), HistogramValue.EMPTY.observe(40).observe(700)),
    MetricPoint.counter(MetricKey.of(MetricCatalog.TOOL_INVOCATIONS, MetricLabels.of({ ...tool, status: LabelValue.of("succeeded") })), 3),
  ]);
  assert.equal(new PrometheusTextRenderer().render(snapshot), [
    "# HELP pi_runtime_tool_invocations_total Tool invocations by final status.",
    "# TYPE pi_runtime_tool_invocations_total counter",
    'pi_runtime_tool_invocations_total{server="kmp",status="succeeded",tool="kmp_ask"} 3',
    "# HELP pi_runtime_tool_duration_ms Tool invocation duration in milliseconds.",
    "# TYPE pi_runtime_tool_duration_ms histogram",
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="10"} 0',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="50"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="100"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="250"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="500"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="1000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="2500"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="5000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="10000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="30000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="60000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="+Inf"} 2',
    'pi_runtime_tool_duration_ms_sum{server="kmp",tool="kmp_ask"} 740',
    'pi_runtime_tool_duration_ms_count{server="kmp",tool="kmp_ask"} 2',
    "# HELP pi_runtime_cost_total Model cost in the unit reported by Pi.",
    "# TYPE pi_runtime_cost_total counter",
    'pi_runtime_cost_total{model="m1",provider="p1"} 0.75',
  ].join("\n"));
  assert.equal(new PrometheusTextRenderer().render(MetricsSnapshot.of([])), "");
});
```

`tests/unit/adapters/inbound/cli/MetricsCli.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MetricsCli } from "../../../../../src/adapters/inbound/cli/MetricsCli.ts";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { TelemetryMetricsProjection } from "../../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../../src/application/services/ProjectionRunner.ts";
import { ProjectionLag } from "../../../../../src/application/use-cases/ProjectionLag.ts";
import { ReadTelemetryMetrics } from "../../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

function world(project = true) {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("tool.completed", "c", { tool: "kmp_ask", server: "kmp", callId: "c", durationMs: 40, status: "succeeded" })], AT);
  const list = [new TelemetryMetricsProjection()];
  if (project) new ProjectionRunner(events, store, list).runOnce();
  const out: string[] = [];
  return { out, cli: new MetricsCli({ read: new ReadTelemetryMetrics(events, store), lag: new ProjectionLag(events, store, list), print: (s) => out.push(s) }) };
}

test("imprime el texto Prometheus del acumulado y, con --session, el de esa sesión", () => {
  const { cli, out } = world();
  assert.equal(cli.run([]), 0);
  assert.match(out.join("\n"), /^pi_runtime_sessions_total\{event="opened"\} 1$/m);
  assert.match(out.join("\n"), /^pi_runtime_tool_duration_ms_bucket\{server="kmp",tool="kmp_ask",le="50"\} 1$/m);
  out.length = 0;
  assert.equal(cli.run(["--session", "s1"]), 0);
  assert.match(out.join("\n"), /^pi_runtime_tool_invocations_total\{server="kmp",status="succeeded",tool="kmp_ask"\} 1$/m);
  out.length = 0;
  assert.equal(cli.run(["--session", "otra"]), 0);
  assert.deepEqual(out, ["# no metrics recorded yet"]);
});

test("proyección atrasada: aviso como comentario; uso incorrecto sale con 2; sesión inválida con 1", () => {
  const { cli, out } = world(false);
  assert.equal(cli.run([]), 0);
  assert.deepEqual(out, ["# projections behind (0/2): start pi in this project or run underpass events rebuild telemetry_metrics"]);
  for (const args of [["x"], ["--session"], ["--session", ""], ["--session", "a", "b"]]) {
    out.length = 0;
    assert.equal(cli.run(args), 2, JSON.stringify(args));
    assert.deepEqual(out, ["usage: underpass metrics [--session <id>]"]);
  }
  out.length = 0;
  assert.equal(cli.run(["--session", "a b"]), 1);
  assert.match(out[0], /^error: invalid session id/);
});
```

Al final de `tests/unit/adapters/inbound/cli/UnderpassCli.test.ts` (usa el `report` que ya define ese fichero):

```ts
test("metrics delega en su CLI con el resto de argumentos; sin él, uso", async () => {
  const out: string[] = []; const seen: string[][] = [];
  const cli = new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(false) }, (s) => out.push(s), null, { run: (a) => { seen.push(a); return 0; } });
  assert.equal(await cli.run(["metrics", "--session", "s1"]), 0);
  assert.deepEqual(seen, [["--session", "s1"]]);
  assert.equal(await new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(false) }, (s) => out.push(s)).run(["metrics"]), 2);
  assert.match(out.at(-1)!, /\| metrics \[--session <id>\]$/);
});
```

Al final de `tests/unit/composition/CliComposition.test.ts`:

```ts
test("metrics sin log: comentario de vacío, exit 0 y sin crear estado", async () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-home-"));
  const state = join(home, ".local/state");
  const out: string[] = [];
  const cli = CliComposition.build({ ...process.env, HOME: home, XDG_STATE_HOME: state, XDG_DATA_HOME: join(home, ".local/share"), XDG_CONFIG_HOME: join(home, ".config") }, (s) => out.push(s));
  assert.equal(await cli.run(["metrics"]), 0);
  assert.deepEqual(out, ["# no metrics recorded yet"]);
  assert.equal(existsSync(state), false);
});
```

Al final de `tests/unit/composition/EventLogComposition.test.ts` (añade los imports de `SqliteDatabase`, `SqliteProjectionStore`, `SqliteTelemetryEpochStore` y `TraceExport`):

```ts
test("rebuild telemetry_metrics fija un inicio del acumulado en meta, rebuild otlp_traces pone su cursor a 0 y metrics lee el log", () => {
  const { home, out, composition, log } = setup();
  assert.equal(composition.cli().run(["import", bundle(home)]), 0);
  assert.equal(composition.cli().run(["rebuild", "telemetry_metrics"]), 0);
  assert.equal(composition.cli().run(["rebuild", "otlp_traces"]), 0);
  assert.deepEqual(out.slice(-2), ["rebuilt telemetry_metrics", "rebuilt otlp_traces"]);
  out.length = 0;
  assert.equal(composition.metrics().run([]), 0);
  assert.match(out.join("\n"), /^pi_runtime_sessions_total\{event="opened"\} 1$/m);
  const db = SqliteDatabase.open(log);
  try {
    assert.notEqual(new SqliteTelemetryEpochStore(db).read(), null);
    assert.equal(new SqliteProjectionStore(db).cursor(TraceExport.NAME)?.position.value, 0);
  } finally { db.close(); }
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/inbound/cli/MetricsCli.test.ts`
Expected: FAIL por `Cannot find module …/MetricsCli.ts`.

- [ ] **Step 3: Implementar**

`src/adapters/inbound/cli/PrometheusTextRenderer.ts`:

```ts
import { HistogramValue } from "../../../domain/telemetry/HistogramValue.ts";
import type { MetricsSnapshot } from "../../../domain/telemetry/MetricsSnapshot.ts";

const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (entries: [string, string][]) => (entries.length === 0 ? "" : `{${entries.map(([k, v]) => `${k}="${escape(v)}"`).join(",")}}`);

// Formato de exposición de Prometheus (texto 0.0.4): # HELP, # TYPE, labels ordenados
// por nombre (y `le` al final en los cubos), histograma con _bucket acumulado, _sum y _count.
export class PrometheusTextRenderer {
  render(snapshot: MetricsSnapshot): string {
    const lines: string[] = [];
    for (const { descriptor: d, points } of snapshot.byDescriptor()) {
      lines.push(`# HELP ${d.name} ${d.help}`, `# TYPE ${d.name} ${d.kind}`);
      for (const p of points) {
        const base = p.key.labels.entries();
        if (p.histogram === null) { lines.push(`${d.name}${labels(base)} ${p.value}`); continue; }
        const cumulative = p.histogram.cumulative();
        HistogramValue.BOUNDS.forEach((bound, i) => lines.push(`${d.name}_bucket${labels([...base, ["le", String(bound)]])} ${cumulative[i]}`));
        lines.push(`${d.name}_bucket${labels([...base, ["le", "+Inf"]])} ${p.histogram.count}`);
        lines.push(`${d.name}_sum${labels(base)} ${p.histogram.sum}`, `${d.name}_count${labels(base)} ${p.histogram.count}`);
      }
    }
    return lines.join("\n");
  }
}
```

`src/adapters/inbound/cli/MetricsCli.ts`:

```ts
import { TelemetryMetricsProjection } from "../../../application/projections/TelemetryMetricsProjection.ts";
import type { ProjectionLag } from "../../../application/use-cases/ProjectionLag.ts";
import type { ReadTelemetryMetrics } from "../../../application/use-cases/ReadTelemetryMetrics.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import { PrometheusTextRenderer } from "./PrometheusTextRenderer.ts";

type Deps = { read: ReadTelemetryMetrics; lag: ProjectionLag; print: (s: string) => void };
const USAGE = "usage: underpass metrics [--session <id>]";

// `underpass metrics [--session <id>]`. Los avisos van como comentarios (`#`): la salida
// sigue siendo texto Prometheus válido.
export class MetricsCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  run(args: string[]): number {
    const d = this.#d;
    const valid = args.length === 0 || (args.length === 2 && args[0] === "--session" && args[1] !== "");
    if (!valid) { d.print(USAGE); return 2; }
    try {
      const session = args.length === 2 ? SessionId.of(args[1]) : undefined;
      const behind = session === undefined ? d.lag.execute(TelemetryMetricsProjection.NAME) : [];
      for (const b of behind) d.print(`# projections behind (${b.position}/${b.last}): start pi in this project or run underpass events rebuild ${b.projection}`);
      const snapshot = d.read.execute(session);
      if (snapshot.isEmpty()) { if (behind.length === 0) d.print("# no metrics recorded yet"); return 0; }
      d.print(new PrometheusTextRenderer().render(snapshot));
      return 0;
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }
}
```

`src/adapters/inbound/cli/UnderpassCli.ts` (contenido completo):

```ts
import { CheckMapper } from "../../../application/mappers/CheckMapper.ts";
import type { DiagnosisReport } from "../../../domain/diagnosis/DiagnosisReport.ts";
import { CheckRenderer } from "./CheckRenderer.ts";

type Runs = { execute(record?: boolean): Promise<DiagnosisReport> };
type Verb = { run(args: string[]): number };
const USAGE = "usage: underpass setup | doctor | update | events <sessions|show|tools|verify|export|import|rebuild|ack-gaps> | metrics [--session <id>]";

export class UnderpassCli {
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void; readonly #events: Verb | null; readonly #metrics: Verb | null;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void, events: Verb | null = null, metrics: Verb | null = null) {
    this.#setup = setup; this.#doctor = doctor; this.#print = print; this.#events = events; this.#metrics = metrics;
  }

  async run(argv: string[]): Promise<number> {
    const verb = argv[0];
    const mapper = new CheckMapper();
    const renderer = new CheckRenderer();
    const render = (report: DiagnosisReport) => renderer.render(report.checks().map((c) => mapper.toDto(c)));

    if (verb === "setup" || verb === "update") {
      const setupReport = await this.#setup.execute();
      const doctorReport = await this.#doctor.execute(verb === "setup");
      this.#print(`== setup ==\n${render(setupReport)}\n== doctor ==\n${render(doctorReport)}`);
      return setupReport.hasFailures() || doctorReport.hasFailures() ? 1 : 0;
    }
    if (verb === "doctor") {
      const doctorReport = await this.#doctor.execute(false);
      this.#print(render(doctorReport));
      return doctorReport.hasFailures() ? 1 : 0;
    }
    if (verb === "events" && this.#events !== null) return this.#events.run(argv.slice(1));
    if (verb === "metrics" && this.#metrics !== null) return this.#metrics.run(argv.slice(1));
    this.#print(USAGE);
    return 2;
  }
}
```

`src/composition/EventLogComposition.ts` (contenido completo):

```ts
import { existsSync, readFileSync } from "node:fs";
import { EventsCli } from "../adapters/inbound/cli/EventsCli.ts";
import { MetricsCli } from "../adapters/inbound/cli/MetricsCli.ts";
import { SystemClock } from "../adapters/outbound/clock/SystemClock.ts";
import { FsSpoolGapMarkers } from "../adapters/outbound/fs/FsSpoolGapMarkers.ts";
import { FsSpoolInspector } from "../adapters/outbound/fs/FsSpoolInspector.ts";
import { InMemoryEventStore } from "../adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { SqliteDatabase } from "../adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { SqliteTelemetryEpochStore } from "../adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import type { EventStore } from "../application/ports/EventStore.ts";
import type { Projection } from "../application/ports/Projection.ts";
import type { ProjectionStore } from "../application/ports/ProjectionStore.ts";
import type { TelemetryEpochStore } from "../application/ports/TelemetryEpochStore.ts";
import { QualityKpisProjection } from "../application/projections/QualityKpisProjection.ts";
import { SessionSummaryProjection } from "../application/projections/SessionSummaryProjection.ts";
import { TelemetryMetricsProjection } from "../application/projections/TelemetryMetricsProjection.ts";
import { ToolStatsProjection } from "../application/projections/ToolStatsProjection.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../application/services/TelemetryEpochs.ts";
import { AcknowledgeSpoolGaps } from "../application/use-cases/AcknowledgeSpoolGaps.ts";
import { DiagnoseEventLog } from "../application/use-cases/DiagnoseEventLog.ts";
import { ExportEventLog } from "../application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../application/use-cases/ImportEventLog.ts";
import { ListSessions } from "../application/use-cases/ListSessions.ts";
import { ProjectionLag } from "../application/use-cases/ProjectionLag.ts";
import { ReadTelemetryMetrics } from "../application/use-cases/ReadTelemetryMetrics.ts";
import { RebuildProjection } from "../application/use-cases/RebuildProjection.ts";
import { ShowSession } from "../application/use-cases/ShowSession.ts";
import { ToolStatsReport } from "../application/use-cases/ToolStatsReport.ts";
import { VerifyEventLog } from "../application/use-cases/VerifyEventLog.ts";
import type { Check } from "../domain/diagnosis/Check.ts";
import type { Project } from "../domain/project/Project.ts";
import { LazyEventStore } from "./LazyEventStore.ts";
import { LazyProjectionStore } from "./LazyProjectionStore.ts";
import type { StatePaths } from "./StatePaths.ts";

// read: sólo lectura (doctor y consultas); write: lectura-escritura si el log existe (rebuild); create: lo crea (import).
type Mode = "read" | "write" | "create";
type Stores = { events: EventStore; projections: ProjectionStore; epochs: TelemetryEpochStore; persisted: boolean };

// Cableado del log de eventos para el CLI. Sin log, lectura y rebuild trabajan sobre almacenes vacíos en memoria:
// nada se crea salvo con `events import`, y aun entonces sólo tras validar el bundle.
export class EventLogComposition {
  readonly #log: string; readonly #spool: string; readonly #project: Project; readonly #print: (s: string) => void;
  constructor(paths: StatePaths, project: Project, print: (s: string) => void) {
    this.#log = paths.eventLogOf(project); this.#spool = paths.spoolDirOf(project); this.#project = project; this.#print = print;
  }

  diagnosis(): { execute(): Check[] } {
    return {
      execute: () => {
        const s = this.#open("read");
        // Sin log no hay cursores que comparar: la lista vacía evita un falso "version mismatch".
        return new DiagnoseEventLog(s.events, s.projections, s.persisted ? this.#projections() : [], new FsSpoolInspector(this.#spool)).execute();
      },
    };
  }

  cli(): { run(args: string[]): number } {
    return {
      run: (args: string[]) => {
        const mode: Mode = args[0] === "import" ? "create" : args[0] === "rebuild" ? "write" : "read";
        let stores: Stores | null = null;
        const resolve = () => (stores ??= this.#open(mode));
        const events = new LazyEventStore(() => resolve().events); const projections = new LazyProjectionStore(() => resolve().projections);
        return new EventsCli({
          sessions: new ListSessions(projections), show: new ShowSession(events), tools: new ToolStatsReport(projections), verify: new VerifyEventLog(events),
          exportLog: new ExportEventLog(events, this.#project.id), importLog: new ImportEventLog(events, this.#project.id),
          rebuild: new RebuildProjection(new ProjectionRunner(events, projections, this.#projections()), projections, this.#epochs(resolve)),
          lag: new ProjectionLag(events, projections, this.#projections()), ackGaps: new AcknowledgeSpoolGaps(new FsSpoolGapMarkers(this.#spool)), readFile: (p) => readFileSync(p, "utf8"), print: this.#print,
        }).run(args);
      },
    };
  }

  metrics(): { run(args: string[]): number } {
    return {
      run: (args: string[]) => {
        let stores: Stores | null = null;
        const resolve = () => (stores ??= this.#open("read"));
        const events = new LazyEventStore(() => resolve().events); const projections = new LazyProjectionStore(() => resolve().projections);
        return new MetricsCli({ read: new ReadTelemetryMetrics(events, projections), lag: new ProjectionLag(events, projections, this.#projections()), print: this.#print }).run(args);
      },
    };
  }

  // Las mismas proyecciones que mantiene el host (HostComposition).
  #projections(): Projection[] { return [new SessionSummaryProjection(), new ToolStatsProjection(), new TelemetryMetricsProjection(), new QualityKpisProjection()]; }

  #epochs(resolve: () => Stores): TelemetryEpochs {
    return new TelemetryEpochs({ read: () => resolve().epochs.read(), write: (e) => resolve().epochs.write(e) }, new SystemClock());
  }

  #open(mode: Mode): Stores {
    if (mode !== "create" && !existsSync(this.#log)) return { events: new InMemoryEventStore(), projections: new InMemoryProjectionStore(), epochs: new InMemoryTelemetryEpochStore(), persisted: false };
    const db = mode === "read" ? SqliteDatabase.openReadOnly(this.#log) : SqliteDatabase.open(this.#log);
    return { events: new SqliteEventStore(db), projections: new SqliteProjectionStore(db), epochs: new SqliteTelemetryEpochStore(db), persisted: true };
  }
}
```

`src/composition/CliComposition.ts`: la última línea de `build` pasa a

```ts
    return new UnderpassCli(setup, doctor, print, eventLog.cli(), eventLog.metrics());
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS (los tests de uso existentes siguen casando: el texto conserva `update | events <…|ack-gaps>`), cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/adapters/inbound/cli tests/unit/composition
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(cli): underpass metrics en formato Prometheus y rebuild de otlp_traces"
```

---

### Task 10: `underpass events kpis` y `underpass events trace`

**Files:**
- Create: `src/application/dto/SpanRowDto.ts`, `src/application/use-cases/SessionTrace.ts`
- Modify: `src/adapters/inbound/cli/EventsCli.ts`, `src/composition/EventLogComposition.ts`, `src/adapters/inbound/cli/UnderpassCli.ts` (texto de uso)
- Test: `tests/unit/application/use-cases/SessionTrace.test.ts`, `tests/unit/adapters/inbound/cli/EventsCliTelemetry.test.ts`; actualizar `tests/unit/adapters/inbound/cli/EventsCli.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5 (`SpanAssembler.feed/flush`), 9.
- Produces:
  - `type SpanRowDto = { depth; name; startedAt: string; durationMs; status: string; detail: string | null; tokens: { input; output } | null; cost: number | null; incomplete: boolean }`
  - `new SessionTrace(events: EventStore)`, `.execute(id: SessionId): SpanRowDto[]` (árbol en profundidad, hermanos por inicio)
  - `EventsCli` deps añade `kpis: QualityKpisReport`, `trace: SessionTrace`, `metrics: ReadTelemetryMetrics`; verbos `kpis [--session s]` y `trace <session>`

- [ ] **Step 1: Tests que fallan**

`tests/unit/application/use-cases/SessionTrace.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { SessionTrace } from "../../../../src/application/use-cases/SessionTrace.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const row = (r: { depth: number; name: string; durationMs: number; status: string; detail: string | null; tokens: unknown; cost: number | null; incomplete: boolean }) =>
  [r.depth, r.name, r.durationMs, r.status, r.detail, r.tokens, r.cost, r.incomplete];

test("árbol de una sesión cerrada: sesión, turnos con sus tools y tools sin turno", () => {
  const events = new InMemoryEventStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", { reason: "startup" }, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 400, status: "succeeded" }, SESSION, 2400),
    fact("turn.completed", "t1", { model: "m", provider: "p", outcome: "completed", tokens: { input: 10, output: 3, cacheRead: 30, cacheWrite: 0 }, cost: 0.25, durationMs: 1500 }, SESSION, 3000),
    fact("tool.completed", "c2", { tool: "kmp_ask", server: "kmp", callId: "c2", durationMs: 20, status: "refused", errorCode: "invalid_argument" }, SESSION, 3100),
    fact("session.closed", "x", { reason: "quit" }, SESSION, 4000),
  ], AT);
  assert.deepEqual(new SessionTrace(events).execute(SessionId.of("s1")).map(row), [
    [0, "session", 3000, "unset", "startup", null, null, false],
    [1, "turn", 1500, "unset", "m completed", { input: 10, output: 3 }, 0.25, false],
    [2, "tool", 400, "unset", "kmp/kmp_ask succeeded", null, null, false],
    [1, "tool", 20, "unset", "kmp/kmp_ask refused", null, null, false],
  ]);
  assert.deepEqual(new SessionTrace(events).execute(SessionId.of("nadie")), []);
});

test("una sesión en curso se muestra con lo abierto como incompleto", () => {
  const events = new InMemoryEventStore(); const s2 = StreamId.session(SessionId.of("s2"));
  events.append(s2, StreamVersion.NONE, [fact("session.opened", "o", {}, s2, 1000), fact("tool.started", "z", { tool: "t", server: "pi", callId: "z" }, s2, 1500)], AT);
  assert.deepEqual(new SessionTrace(events).execute(SessionId.of("s2")).map(row), [
    [0, "session", 500, "unset", null, null, null, true],
    [1, "tool", 0, "unset", "pi/t open", null, null, true],
  ]);
});
```

`tests/unit/adapters/inbound/cli/EventsCliTelemetry.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventsCli } from "../../../../../src/adapters/inbound/cli/EventsCli.ts";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { QualityKpisProjection } from "../../../../../src/application/projections/QualityKpisProjection.ts";
import { TelemetryMetricsProjection } from "../../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../../src/application/services/ProjectionRunner.ts";
import { AcknowledgeSpoolGaps } from "../../../../../src/application/use-cases/AcknowledgeSpoolGaps.ts";
import { ExportEventLog } from "../../../../../src/application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../../../../../src/application/use-cases/ImportEventLog.ts";
import { ListSessions } from "../../../../../src/application/use-cases/ListSessions.ts";
import { ProjectionLag } from "../../../../../src/application/use-cases/ProjectionLag.ts";
import { QualityKpisReport } from "../../../../../src/application/use-cases/QualityKpisReport.ts";
import { ReadTelemetryMetrics } from "../../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { RebuildProjection } from "../../../../../src/application/use-cases/RebuildProjection.ts";
import { SessionTrace } from "../../../../../src/application/use-cases/SessionTrace.ts";
import { ShowSession } from "../../../../../src/application/use-cases/ShowSession.ts";
import { ToolStatsReport } from "../../../../../src/application/use-cases/ToolStatsReport.ts";
import { VerifyEventLog } from "../../../../../src/application/use-cases/VerifyEventLog.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { ProjectId } from "../../../../../src/domain/project/ProjectId.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

function cli() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", { reason: "startup" }, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 400, status: "succeeded" }, SESSION, 2400),
    fact("turn.completed", "t1", { model: "m", provider: "p", outcome: "completed", tokens: { input: 10, output: 3, cacheRead: 30, cacheWrite: 0 }, cost: 0.25, durationMs: 1500 }, SESSION, 3000),
    fact("tool.completed", "c2", { tool: "kmp_ask", server: "kmp", callId: "c2", durationMs: 20, status: "refused", errorCode: "invalid_argument" }, SESSION, 3100),
    fact("session.closed", "x", { reason: "quit" }, SESSION, 4000),
  ], AT);
  const list = [new QualityKpisProjection(), new TelemetryMetricsProjection()];
  const runner = new ProjectionRunner(events, store, list);
  runner.runOnce();
  const out: string[] = [];
  const project = ProjectId.of("0123456789abcdef");
  const c = new EventsCli({
    sessions: new ListSessions(store), show: new ShowSession(events), tools: new ToolStatsReport(store), kpis: new QualityKpisReport(store), trace: new SessionTrace(events),
    metrics: new ReadTelemetryMetrics(events, store), verify: new VerifyEventLog(events), exportLog: new ExportEventLog(events, project), importLog: new ImportEventLog(events, project),
    rebuild: new RebuildProjection(runner), lag: new ProjectionLag(events, store, list), ackGaps: new AcknowledgeSpoolGaps({ list: () => [], remove: () => {} }),
    readFile: () => "", print: (s) => out.push(s),
  });
  return { c, out };
}

test("kpis: tabla global con éxito a la primera, negativas, caché, compactaciones y latencia estimada por tool", () => {
  const { c, out } = cli();
  assert.equal(c.run(["kpis"]), 0);
  assert.deepEqual(out, [
    "scope        global",
    "sessions     1",
    "turns        1",
    "cost         0.2500",
    "tokens       input=10 output=3 cache_read=30 cache_write=0",
    "first-try    50.0%",
    "refusals     50.0% of 2 calls",
    "cache ratio  75.0%",
    "compactions  0 (0.00/session)",
    "latency      kmp/kmp_ask p50<=50ms p95<=500ms",
  ]);
  out.length = 0;
  assert.equal(c.run(["kpis", "--session", "s1"]), 0);
  assert.equal(out[0], "scope        s1");
  assert.equal(out.at(-1), "latency      kmp/kmp_ask p50<=50ms p95<=500ms");
  out.length = 0;
  assert.equal(c.run(["kpis", "--session", "nadie"]), 0);
  assert.deepEqual(out, ["no KPIs for session nadie"]);
});

test("trace: árbol de spans con duración, estado, tokens y coste por turno", () => {
  const { c, out } = cli();
  assert.equal(c.run(["trace", "s1"]), 0);
  assert.deepEqual(out, [
    "session  3000ms  unset  startup",
    "  turn  1500ms  unset  m completed  tokens=10+3  cost=0.2500",
    "    tool  400ms  unset  kmp/kmp_ask succeeded",
    "  tool  20ms  unset  kmp/kmp_ask refused",
  ]);
  out.length = 0;
  assert.equal(c.run(["trace", "nadie"]), 0);
  assert.deepEqual(out, ["no events for session nadie"]);
});

test("kpis y trace con uso incorrecto salen con 2", () => {
  const { c, out } = cli();
  for (const args of [["kpis", "x"], ["kpis", "--session"], ["trace"]]) {
    out.length = 0;
    assert.equal(c.run(args), 2, JSON.stringify(args));
    assert.match(out[0], /^usage: underpass events .*kpis \[--session s\]\|trace <session>/);
  }
});
```

En `tests/unit/adapters/inbound/cli/EventsCli.test.ts`:
- añade los imports `QualityKpisReport`, `SessionTrace` y `ReadTelemetryMetrics` (de `src/application/use-cases/…`);
- en `cli()`, tras `lag: new ProjectionLag(events, store, list),` añade `kpis: new QualityKpisReport(store), trace: new SessionTrace(events), metrics: new ReadTelemetryMetrics(events, store),`;
- el texto de uso esperado pasa a:

```ts
  const usage = "usage: underpass events sessions [--since t]|show <session>|tools|kpis [--session s]|trace <session>|verify [--stream s]|export [--since n]|import <file>|rebuild <projection>|ack-gaps";
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/inbound/cli/EventsCliTelemetry.test.ts`
Expected: FAIL por `Cannot find module …/SessionTrace.ts`.

- [ ] **Step 3: Implementar**

`src/application/dto/SpanRowDto.ts`:

```ts
// Una fila de `underpass events trace`: el span a su profundidad en el árbol. tokens y cost sólo en turnos.
export type SpanRowDto = {
  depth: number;
  name: string;
  startedAt: string;
  durationMs: number;
  status: string;
  detail: string | null;
  tokens: { input: number; output: number } | null;
  cost: number | null;
  incomplete: boolean;
};
```

`src/application/use-cases/SessionTrace.ts`:

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import type { Span } from "../../domain/telemetry/Span.ts";
import { SpanAssembler } from "../../domain/telemetry/SpanAssembler.ts";
import type { SpanRowDto } from "../dto/SpanRowDto.ts";
import type { EventStore } from "../ports/EventStore.ts";

// Árbol de spans de una sesión, ensamblado desde su stream con el mismo SpanAssembler que
// el exportador. Lo que sigue abierto se cierra en el último hecho como incompleto.
export class SessionTrace {
  readonly #events: EventStore;
  constructor(events: EventStore) { this.#events = events; }

  execute(id: SessionId): SpanRowDto[] {
    const records = this.#events.readStream(StreamId.session(id));
    if (records.length === 0) return [];
    const assembler = new SpanAssembler(SpanAssembler.empty());
    const spans = records.flatMap((r) => assembler.feed(r));
    spans.push(...assembler.flush(records[records.length - 1].occurredAt));
    const ids = new Set(spans.map((s) => s.spanId.value));
    const children = new Map<string, Span[]>();
    for (const s of spans) {
      const parent = s.parentId !== null && ids.has(s.parentId.value) ? s.parentId.value : "";
      children.set(parent, [...(children.get(parent) ?? []), s]);
    }
    const rows: SpanRowDto[] = [];
    const walk = (parent: string, depth: number) => {
      const siblings = [...(children.get(parent) ?? [])].sort((a, b) => a.start.epochMs() - b.start.epochMs() || a.end.epochMs() - b.end.epochMs());
      for (const s of siblings) { rows.push(SessionTrace.#row(s, depth)); walk(s.spanId.value, depth + 1); }
    };
    walk("", 0);
    return rows;
  }

  static #row(s: Span, depth: number): SpanRowDto {
    const text = (k: string) => { const v = s.attributes.get(k); return v === null ? null : String(v); };
    const count = (k: string) => { const v = s.attributes.get(k); return typeof v === "number" ? v : 0; };
    const cost = s.attributes.get("pi_runtime.cost");
    const detail = s.name === "tool" ? `${text("pi_runtime.server") ?? "?"}/${text("pi_runtime.tool") ?? "?"} ${text("pi_runtime.status") ?? "open"}`
      : s.name === "turn" ? `${text("pi_runtime.model") ?? "?"} ${text("pi_runtime.outcome") ?? "?"}`
      : s.name === "session" ? text("pi_runtime.open_reason") : null;
    return {
      depth, name: s.name, startedAt: s.start.value, durationMs: s.durationMs(), status: s.status.value, detail,
      tokens: s.name === "turn" ? { input: count("pi_runtime.tokens.input"), output: count("pi_runtime.tokens.output") } : null,
      cost: s.name === "turn" && typeof cost === "number" ? cost : null,
      incomplete: s.attributes.get("pi_runtime.incomplete") === true,
    };
  }
}
```

`src/adapters/inbound/cli/EventsCli.ts` (contenido completo):

```ts
import type { QualityKpisDto } from "../../../application/dto/QualityKpisDto.ts";
import type { SpanRowDto } from "../../../application/dto/SpanRowDto.ts";
import { QualityKpisProjection } from "../../../application/projections/QualityKpisProjection.ts";
import { SessionSummaryProjection } from "../../../application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../../../application/projections/ToolStatsProjection.ts";
import type { AcknowledgeSpoolGaps } from "../../../application/use-cases/AcknowledgeSpoolGaps.ts";
import type { ExportEventLog } from "../../../application/use-cases/ExportEventLog.ts";
import type { ImportEventLog } from "../../../application/use-cases/ImportEventLog.ts";
import type { ListSessions } from "../../../application/use-cases/ListSessions.ts";
import type { ProjectionLag } from "../../../application/use-cases/ProjectionLag.ts";
import type { QualityKpisReport } from "../../../application/use-cases/QualityKpisReport.ts";
import type { ReadTelemetryMetrics } from "../../../application/use-cases/ReadTelemetryMetrics.ts";
import type { RebuildProjection } from "../../../application/use-cases/RebuildProjection.ts";
import type { SessionTrace } from "../../../application/use-cases/SessionTrace.ts";
import type { ShowSession } from "../../../application/use-cases/ShowSession.ts";
import type { ToolStatsReport } from "../../../application/use-cases/ToolStatsReport.ts";
import type { VerifyEventLog } from "../../../application/use-cases/VerifyEventLog.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ProjectionName } from "../../../domain/events/ProjectionName.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import { StreamId } from "../../../domain/events/StreamId.ts";
import { Timestamp } from "../../../domain/events/Timestamp.ts";
import { CanonicalJson } from "../../../domain/shared/CanonicalJson.ts";
import { HistogramValue } from "../../../domain/telemetry/HistogramValue.ts";

type Deps = {
  sessions: ListSessions; show: ShowSession; tools: ToolStatsReport; kpis: QualityKpisReport; trace: SessionTrace; metrics: ReadTelemetryMetrics;
  verify: VerifyEventLog; exportLog: ExportEventLog; importLog: ImportEventLog; rebuild: RebuildProjection; lag: ProjectionLag; ackGaps: AcknowledgeSpoolGaps;
  readFile: (path: string) => string; print: (s: string) => void;
};
const USAGE = "usage: underpass events sessions [--since t]|show <session>|tools|kpis [--session s]|trace <session>|verify [--stream s]|export [--since n]|import <file>|rebuild <projection>|ack-gaps";
const opt = (args: string[], flag: string): string | null => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? "" : null; };
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const bound = (v: number | null) => (v === null ? "-" : v === Number.POSITIVE_INFINITY ? `>${HistogramValue.BOUNDS[HistogramValue.BOUNDS.length - 1]}ms` : `<=${v}ms`);

export class EventsCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  run(args: string[]): number {
    const [cmd, arg] = args; const d = this.#d;
    try {
      switch (cmd) {
        case "sessions": {
          const since = opt(args, "--since");
          let from: Timestamp | undefined;
          if (since !== null) { try { from = Timestamp.parse(since); } catch { return this.#usage(); } }
          const sessions = d.sessions.execute(from);
          const behind = this.#hints(SessionSummaryProjection.NAME);
          if (sessions.length === 0 && !behind) d.print("no sessions recorded yet");
          for (const s of sessions) d.print(`${s.sessionId}  ${s.openedAt ?? "-"}  ${s.phase ?? "-"}  turns=${s.turns}  tokens=${s.tokens.input}+${s.tokens.output}  cost=${s.cost.toFixed(4)}  failures=${s.failures}`);
          return 0;
        }
        case "show": {
          if (!arg) return this.#usage();
          const timeline = d.show.execute(SessionId.of(arg));
          if (timeline.length === 0) d.print(`no events for session ${arg}`);
          for (const r of timeline) d.print(`v${r.version}  ${r.occurredAt}  ${r.type}  ${CanonicalJson.of(r.payload).text}`);
          return 0;
        }
        case "tools": {
          const rows = d.tools.execute();
          const behind = this.#hints(ToolStatsProjection.NAME);
          if (rows.length === 0 && !behind) d.print("no tool calls recorded yet");
          for (const t of rows) d.print(`${t.server}/${t.tool}  n=${t.n}  ok=${t.succeeded}  fail=${t.failed}  refused=${t.refused}  aborted=${t.aborted}  p50=${t.p50 ?? "-"}  p95=${t.p95 ?? "-"}`);
          return 0;
        }
        case "kpis": {
          const s = opt(args, "--session");
          if (s === "" || (s === null && args.length > 1)) return this.#usage();
          const session = s === null ? undefined : SessionId.of(s);
          const k = d.kpis.execute(session);
          this.#hints(QualityKpisProjection.NAME);
          if (k === null) { d.print(`no KPIs for session ${s}`); return 0; }
          this.#kpis(k);
          for (const p of d.metrics.execute(session).points()) {
            if (p.histogram === null) continue;
            d.print(`latency      ${p.key.labels.get("server")}/${p.key.labels.get("tool")} p50${bound(p.histogram.quantile(0.5))} p95${bound(p.histogram.quantile(0.95))}`);
          }
          return 0;
        }
        case "trace": {
          if (!arg) return this.#usage();
          const rows = d.trace.execute(SessionId.of(arg));
          if (rows.length === 0) d.print(`no events for session ${arg}`);
          for (const r of rows) d.print(EventsCli.#span(r));
          return 0;
        }
        case "verify": {
          const s = opt(args, "--stream");
          if (s === "") return this.#usage();
          const results = d.verify.execute(s === null ? undefined : StreamId.of(s));
          if (results.length === 0) d.print("no streams recorded yet");
          for (const x of results) d.print(`${x.stream.value}  ${x.result.kind}${x.result.reason ? ` at v${x.result.version?.value}: ${x.result.reason}` : ""}`);
          // Pedir un stream concreto que no existe es un fallo; el log entero sin streams no lo es.
          return results.some((x) => x.result.kind === "broken" || (s !== null && x.result.kind === "notFound")) ? 1 : 0;
        }
        case "export": {
          const since = opt(args, "--since");
          if (since !== null && !/^\d+$/.test(since)) return this.#usage();
          for (const l of d.exportLog.execute(since === null ? GlobalPosition.START : GlobalPosition.of(Number(since)))) d.print(l);
          return 0;
        }
        case "import": {
          if (!arg) return this.#usage();
          const { imported, warnings } = d.importLog.execute(d.readFile(arg).split("\n"));
          for (const w of warnings) d.print(`warning: ${w}`);
          d.print(`imported ${imported} events`);
          if (imported > 0) this.#hints();
          return 0;
        }
        case "rebuild":
          if (!arg) return this.#usage();
          d.rebuild.execute(ProjectionName.of(arg));
          d.print(`rebuilt ${arg}`);
          return 0;
        case "ack-gaps": {
          const acknowledged = d.ackGaps.execute();
          if (acknowledged.length === 0) d.print("no spool gap markers to acknowledge");
          else { for (const m of acknowledged) d.print(`acknowledged ${m}`); d.print(`acknowledged ${acknowledged.length} spool gap marker(s)`); }
          return 0;
        }
        default:
          return this.#usage();
      }
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }

  #kpis(k: QualityKpisDto): void {
    const p = this.#d.print;
    p(`scope        ${k.scope}`);
    p(`sessions     ${k.sessions}`);
    p(`turns        ${k.turns}`);
    p(`cost         ${k.cost.toFixed(4)}`);
    p(`tokens       input=${k.tokens.input} output=${k.tokens.output} cache_read=${k.tokens.cacheRead} cache_write=${k.tokens.cacheWrite}`);
    p(`first-try    ${pct(k.firstTrySuccess)}`);
    p(`refusals     ${pct(k.refusalRate)} of ${k.invocations} calls`);
    p(`cache ratio  ${pct(k.cacheRatio)}`);
    p(`compactions  ${k.compactions}${k.compactionsPerSession === null ? "" : ` (${k.compactionsPerSession.toFixed(2)}/session)`}`);
  }

  static #span(r: SpanRowDto): string {
    return `${"  ".repeat(r.depth)}${r.name}  ${r.durationMs}ms  ${r.status}${r.detail ? `  ${r.detail}` : ""}`
      + `${r.tokens ? `  tokens=${r.tokens.input}+${r.tokens.output}` : ""}${r.cost === null ? "" : `  cost=${r.cost.toFixed(4)}`}${r.incomplete ? "  incomplete" : ""}`;
  }

  // Las proyecciones las mantiene el host; el CLI no las ejecuta, sólo avisa si van por detrás del log.
  #hints(only?: ProjectionName): boolean {
    const behind = this.#d.lag.execute(only);
    for (const b of behind) this.#d.print(`projections behind (${b.position}/${b.last}): start pi in this project or run underpass events rebuild ${b.projection}`);
    return behind.length > 0;
  }

  #usage(): number { this.#d.print(USAGE); return 2; }
}
```

`src/composition/EventLogComposition.ts`: en `cli()`, añade los imports de `QualityKpisReport` y `SessionTrace` y, en el objeto de dependencias de `EventsCli`, tras `tools: new ToolStatsReport(projections),`, añade:

```ts
          kpis: new QualityKpisReport(projections), trace: new SessionTrace(events), metrics: new ReadTelemetryMetrics(events, projections),
```

`src/adapters/inbound/cli/UnderpassCli.ts`: el texto de uso pasa a

```ts
const USAGE = "usage: underpass setup | doctor | update | events <sessions|show|tools|kpis|trace|verify|export|import|rebuild|ack-gaps> | metrics [--session <id>]";
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/application/use-cases/SessionTrace.test.ts tests/unit/adapters/inbound/cli
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(cli): underpass events kpis y events trace"
```

---

### Task 11: `JsonLineLogger` con rotación y stderr del host aparte

**Files:**
- Create: `src/adapters/outbound/log/JsonLineLogger.ts`
- Modify: `src/composition/StatePaths.ts` (+`hostStderrOf`), `src/composition/ExtensionComposition.ts` (el lanzador escribe stdout/stderr en `host.stderr.log`)
- Test: `tests/unit/adapters/outbound/log/JsonLineLogger.test.ts`; añadir una línea a `tests/unit/composition/StatePaths.test.ts`

**Interfaces:**
- Consumes: Task 7 (`HostLog`), E1 `Clock`.
- Produces:
  - `new JsonLineLogger(path: string, clock: Clock, maxBytes = 10 * 1024 * 1024)` implementa `HostLog`; `JsonLineLogger.scrub(text): string`
  - `StatePaths.hostStderrOf(p: Project): string` (`…/projects/<id>/host.stderr.log`)

`host.log` pasa a ser del logger (con rotación); el `DetachedHostLauncher` sigue redirigiendo stdout/stderr del proceso, ahora a `host.stderr.log`, para que un host que muere antes de tener log deje rastro y una rotación nunca deje el descriptor del proceso apuntando a `host.log.1`.

- [ ] **Step 1: Tests que fallan**

`tests/unit/adapters/outbound/log/JsonLineLogger.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLineLogger } from "../../../../../src/adapters/outbound/log/JsonLineLogger.ts";
import { ManualClock } from "../../../../support/ManualClock.ts";

test("una línea JSON por entrada: ts, level, msg, trace_id y span_id en la raíz y los campos", () => {
  const path = join(mkdtempSync(join(tmpdir(), "hostlog-")), "host.log");
  const log = new JsonLineLogger(path, new ManualClock(1000));
  log.info("host started", { version: "0.1.0" });
  log.warn("otlp export failing", { trace_id: "a".repeat(32), span_id: "b".repeat(16), signal: "traces", n: 2, ok: false, gone: null });
  log.error("event log append failed", { error: "ENOENT: no such file or directory, open '/home/u/x/events.sqlite3'", msg: "ignored", trace_id: null });
  const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { ts: "1970-01-01T00:00:01.000Z", level: "info", msg: "host started", version: "0.1.0" },
    { ts: "1970-01-01T00:00:01.000Z", level: "warn", msg: "otlp export failing", trace_id: "a".repeat(32), span_id: "b".repeat(16), signal: "traces", n: 2, ok: false, gone: null },
    { ts: "1970-01-01T00:00:01.000Z", level: "error", msg: "event log append failed", error: "ENOENT: no such file or directory, open '<path>'" },
  ]);
  assert.deepEqual(Object.keys(lines[1]).slice(0, 5), ["ts", "level", "msg", "trace_id", "span_id"]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("scrub: rutas absolutas, ~, de Windows y URLs; el resto queda igual", () => {
  assert.equal(JsonLineLogger.scrub("open '/home/u/secret.txt' failed"), "open '<path>' failed");
  assert.equal(JsonLineLogger.scrub("at /tmp/x.sqlite3: locked"), "at <path> locked");
  assert.equal(JsonLineLogger.scrub("see ~/notes and C:\\Users\\t"), "see <path> and <path>");
  assert.equal(JsonLineLogger.scrub("POST http://collector.internal:4318/v1/traces"), "POST http:<path>");
  assert.equal(JsonLineLogger.scrub("3/5 calls, http 503"), "3/5 calls, http 503");
});

test("rota al llegar al tamaño máximo y conserva sólo host.log.1 a host.log.3", () => {
  const dir = mkdtempSync(join(tmpdir(), "hostlog-"));
  const path = join(dir, "host.log");
  const log = new JsonLineLogger(path, new ManualClock(0), 300);
  for (let i = 0; i < 40; i++) log.info(`line ${i}`, { pad: "x".repeat(40) });
  assert.deepEqual(readdirSync(dir).sort(), ["host.log", "host.log.1", "host.log.2", "host.log.3"]);
  for (const f of readdirSync(dir)) {
    assert.ok(statSync(join(dir, f)).size <= 300, f);
    for (const l of readFileSync(join(dir, f), "utf8").trim().split("\n")) JSON.parse(l);
  }
  assert.match(readFileSync(path, "utf8"), /line 39/);
});

test("nunca lanza aunque no pueda escribir", () => {
  const log = new JsonLineLogger(join(tmpdir(), "no-such-dir-o1", "nested", "host.log"), new ManualClock(0));
  assert.doesNotThrow(() => log.error("x"));
});
```

En `tests/unit/composition/StatePaths.test.ts`, dentro del primer test, tras la aserción de `hostLogOf`:

```ts
  assert.equal(s.hostStderrOf(p), `/h/.local/state/pi-runtime/projects/${p.id}/host.stderr.log`);
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/adapters/outbound/log/JsonLineLogger.test.ts`
Expected: FAIL por `Cannot find module …/JsonLineLogger.ts`.

- [ ] **Step 3: Implementar**

`src/adapters/outbound/log/JsonLineLogger.ts`:

```ts
import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import type { Clock } from "../../../application/ports/Clock.ts";
import type { HostLog } from "../../../application/ports/HostLog.ts";

type Fields = Record<string, string | number | boolean | null>;
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP = 3;
const PATHS = /(^|[\s'"`(=:,])(?:~|[A-Za-z]:)?[\\/][^\s'"`),]*/g;

// Log del host: una línea JSON por entrada (ts, level, msg, trace_id y span_id si vienen,
// y los campos). Rota a 10 MB conservando host.log.1 … host.log.3. Cualquier ruta o URL
// dentro de un texto (p. ej. el mensaje de un error de fs o de SQLite) se sustituye por
// <path>. Nunca lanza: sin log antes que sin host.
export class JsonLineLogger implements HostLog {
  readonly #path: string; readonly #clock: Clock; readonly #maxBytes: number;
  constructor(path: string, clock: Clock, maxBytes = MAX_BYTES) { this.#path = path; this.#clock = clock; this.#maxBytes = maxBytes; }

  info(message: string, fields: Fields = {}): void { this.#write("info", message, fields); }
  warn(message: string, fields: Fields = {}): void { this.#write("warn", message, fields); }
  error(message: string, fields: Fields = {}): void { this.#write("error", message, fields); }

  static scrub(text: string): string { return text.replace(PATHS, "$1<path>"); }

  #write(level: string, message: string, fields: Fields): void {
    const { trace_id: traceId, span_id: spanId, ...rest } = fields;
    const entry: Record<string, unknown> = { ts: this.#clock.now().value, level, msg: JsonLineLogger.scrub(message) };
    if (typeof traceId === "string") entry.trace_id = traceId;
    if (typeof spanId === "string") entry.span_id = spanId;
    for (const [k, v] of Object.entries(rest)) if (!(k in entry)) entry[k] = typeof v === "string" ? JsonLineLogger.scrub(v) : v;
    const line = `${JSON.stringify(entry)}\n`;
    try {
      this.#rotate(Buffer.byteLength(line));
      appendFileSync(this.#path, line, { mode: 0o600 });
    } catch { /* un log que no se puede escribir nunca tumba el host */ }
  }

  #rotate(incoming: number): void {
    if (!existsSync(this.#path) || statSync(this.#path).size + incoming <= this.#maxBytes) return;
    rmSync(`${this.#path}.${KEEP}`, { force: true });
    for (let i = KEEP - 1; i >= 1; i--) if (existsSync(`${this.#path}.${i}`)) renameSync(`${this.#path}.${i}`, `${this.#path}.${i + 1}`);
    renameSync(this.#path, `${this.#path}.1`);
  }
}
```

`src/composition/StatePaths.ts`: tras `hostLogOf`, añade

```ts
  hostStderrOf(p: Project): string { return join(this.projectDir(p), "host.stderr.log"); }
```

`src/composition/ExtensionComposition.ts`: en `#shared()`, el `DetachedHostLauncher` recibe `(p) => paths.hostStderrOf(p)` en lugar de `(p) => paths.hostLogOf(p)`.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/adapters/outbound/log tests/unit/composition/StatePaths.test.ts
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(host): log JSON por líneas con rotación a 10 MB y stderr del proceso aparte"
```

---

### Task 12: Cableado del host — proyecciones, exportador, log JSON y `/underpass-status`

**Files:**
- Create: `src/composition/TelemetryEnvironment.ts`
- Modify: `src/composition/HostComposition.ts`, `src/application/dto/SessionStatusDto.ts`, `src/application/use-cases/ReadSessionStatus.ts`, `src/adapters/inbound/pi/HostExtension.ts`
- Test: `tests/unit/composition/TelemetryEnvironment.test.ts`; añadir casos a `tests/unit/application/use-cases/ReadSessionStatus.test.ts`, `tests/unit/adapters/inbound/pi/extensions.test.ts` y `tests/unit/composition/HostComposition.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6–8, 11.
- Produces:
  - `TelemetryEnvironment.configuration(env): OtlpConfiguration`, `TelemetryEnvironment.resource(env, project: Project): TelemetryResource`
  - `HostComposition.projections(): Projection[]` (las cuatro)
  - `SessionStatusDto` con `kpis?: QualityKpisDto | null` y `exporter?: ExporterStatusDto` (opcionales: un host anterior no los envía)
  - `new ReadSessionStatus(events, summaries, kpis: QualityKpisReport | null = null, exporter: (() => ExporterStatusDto) | null = null)`
  - `/underpass-status`: `kpis: first-try N%, refusals N%, cache N%, compactions N` y `otlp: disabled` · `otlp: ok, lag N` · `otlp: failing since <ts>`

- [ ] **Step 1: Tests que fallan**

`tests/unit/composition/TelemetryEnvironment.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PackageInfo } from "../../../src/composition/PackageInfo.ts";
import { TelemetryEnvironment } from "../../../src/composition/TelemetryEnvironment.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";

test("configuración y recurso desde las variables OTEL_* del entorno", () => {
  assert.equal(TelemetryEnvironment.configuration({}).state, "disabled");
  const c = TelemetryEnvironment.configuration({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318", OTEL_EXPORTER_OTLP_HEADERS: "authorization=x", OTEL_EXPORTER_OTLP_TIMEOUT: "1500" });
  assert.deepEqual([c.state, c.settings?.timeoutMs, c.settings?.headers.names()], ["enabled", 1500, ["authorization"]]);
  assert.equal(TelemetryEnvironment.configuration({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" }).state, "invalid");
  const project = Project.of(ProjectRoot.of("/repo"));
  assert.deepEqual(TelemetryEnvironment.resource({ OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=dev,host.name=box" }, project).attributes().toRecord(), {
    "deployment.environment": "dev", "pi_runtime.project": project.id.value, "service.name": "pi-runtime", "service.version": PackageInfo.version(),
  });
  assert.equal(TelemetryEnvironment.resource({ OTEL_RESOURCE_ATTRIBUTES: "=broken" }, project).attributes().get("service.name"), "pi-runtime", "una lista mal formada se ignora entera");
});
```

Al final de `tests/unit/application/use-cases/ReadSessionStatus.test.ts` (añade los imports de `QualityKpisProjection` y `QualityKpisReport`):

```ts
test("con KPIs y exportador, el estado añade los KPIs de la sesión y el del exportador", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection(), new QualityKpisProjection()]);
  const record = new RecordFact(events, new FixedClock());
  record.execute(fact("session.opened", "open", { reason: "startup" }));
  record.execute(fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", status: "succeeded" }));
  const exporter = { state: "failing" as const, lag: 4, since: "1970-01-01T00:00:10.000Z" };
  const s = new ReadSessionStatus(events, new ReadSessionSummary(store, () => runner.runOnce()), new QualityKpisReport(store), () => exporter).execute(SessionId.of("s1"));
  assert.equal(s.kpis?.firstTrySuccess, 1);
  assert.deepEqual(s.exporter, exporter);
  assert.equal(new ReadSessionStatus(events, new ReadSessionSummary(store), new QualityKpisReport(store)).execute(SessionId.of("otra")).kpis, null);
});
```

Al final de `tests/unit/adapters/inbound/pi/extensions.test.ts` (usa `FakePi`, `gatewayFake` y `summaryOf` del propio fichero):

```ts
test("underpass-status añade los KPIs de la sesión y el estado del exportador OTLP", async () => {
  const pi = new FakePi();
  let exporter: unknown = { state: "disabled", lag: 0, since: null };
  const kpis = { scope: "s1", sessions: 1, turns: 2, cost: 0.5, tokens: { input: 1, output: 1, cacheRead: 3, cacheWrite: 0 }, invocations: 4,
    firstTrySuccess: 0.75, refusalRate: 0.25, cacheRatio: 0.75, compactions: 1, compactionsPerSession: 1 };
  const gw = { ...gatewayFake({ v: false }), summary: async () => ({ summary: summaryOf(2), logPosition: 3, sessionChainIntact: true, kpis, exporter }) };
  const host = new HostExtension(async () => gw, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  await pi.fire("session_start");
  const ctx = { ...pi.ctx, sessionManager: { getSessionId: () => "s1" } };
  await pi.commands.get("underpass-status")!.handler("", ctx);
  assert.match(pi.notes.at(-1)!, /kpis: first-try 75%, refusals 25%, cache 75%, compactions 1/);
  assert.match(pi.notes.at(-1)!, /otlp: disabled/);
  exporter = { state: "ok", lag: 4, since: null };
  await pi.commands.get("underpass-status")!.handler("", ctx);
  assert.match(pi.notes.at(-1)!, /otlp: ok, lag 4/);
  exporter = { state: "failing", lag: 9, since: "2026-09-29T10:00:00.000Z" };
  await pi.commands.get("underpass-status")!.handler("", ctx);
  assert.match(pi.notes.at(-1)!, /otlp: failing since 2026-09-29T10:00:00\.000Z/);
});
```

Al final de `tests/unit/composition/HostComposition.test.ts`:

```ts
test("con OTEL_EXPORTER_OTLP_ENDPOINT el host exporta la traza de su arranque al apagarse y escribe host.log en JSON", async () => {
  const { createServer } = await import("node:http");
  const { existsSync, readFileSync } = await import("node:fs");
  const { hostname } = await import("node:os");
  const received: { path: string; body: { resourceSpans?: { scopeSpans: { spans: { name: string; spanId: string; traceId: string; parentSpanId?: string }[] }[] }[]; resourceMetrics?: { scopeMetrics: { metrics: { name: string }[] }[] }[] } }[] = [];
  const collector = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => { received.push({ path: req.url ?? "", body: JSON.parse(data) }); res.writeHead(200).end("{}"); });
  });
  await new Promise<void>((r) => collector.listen(0, "127.0.0.1", () => r()));
  const port = (collector.address() as { port: number }).port;
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", FAKE_SERVER_CMD: `${process.execPath} ${fake}`,
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20t0p-s3cr3t", OTEL_EXPORTER_OTLP_TIMEOUT: "2000" };
  const paths = new StatePaths(env);
  try {
    const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), new DetachedHostLauncher(hostEntry, env, (p) => paths.hostStderrOf(p)));
    const g = await uc.execute(cwd);
    try { await g.call(ServerName.KMP, ToolName.of("kmp_echo"), { x: 1 }); } finally { g.close(); }
    const project = new GitProjectLocator().locate(cwd);
    const pid = hostStream(paths.eventLogOf(project))[0].payload.pid as number;
    await waitFor(() => !alive(pid));

    const spans = received.filter((r) => r.path === "/v1/traces").flatMap((r) => r.body.resourceSpans![0].scopeSpans[0].spans);
    assert.deepEqual(spans.map((s) => s.name).sort(), ["host", "mcp_server"]);
    const host = spans.find((s) => s.name === "host")!; const server = spans.find((s) => s.name === "mcp_server")!;
    assert.equal(server.parentSpanId, host.spanId);
    assert.equal(server.traceId, host.traceId);
    const metrics = received.filter((r) => r.path === "/v1/metrics").flatMap((r) => r.body.resourceMetrics![0].scopeMetrics[0].metrics.map((m) => m.name));
    assert.ok(metrics.includes("pi_runtime_server_starts_total"));
    const wire = JSON.stringify(received);
    for (const secret of [cwd, home, "t0p-s3cr3t", ...(hostname().length > 3 ? [hostname()] : [])]) assert.equal(wire.includes(secret), false, secret);
    assert.ok(existsSync(paths.hostStderrOf(project)), "stdout/stderr del proceso van a host.stderr.log");
    const logText = existsSync(paths.hostLogOf(project)) ? readFileSync(paths.hostLogOf(project), "utf8") : "";
    for (const line of logText.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      assert.ok(typeof entry.ts === "string" && typeof entry.level === "string" && typeof entry.msg === "string", line);
    }
    assert.equal(logText.includes("t0p-s3cr3t"), false);
  } finally { collector.closeAllConnections(); collector.close(); }
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/composition/TelemetryEnvironment.test.ts tests/unit/composition/HostComposition.test.ts`
Expected: FAIL por `Cannot find module …/TelemetryEnvironment.ts` (y, en el test del host, sin peticiones en el colector).

- [ ] **Step 3: Implementar**

`src/composition/TelemetryEnvironment.ts`:

```ts
import type { Project } from "../domain/project/Project.ts";
import { OtelKeyValueList } from "../domain/telemetry/OtelKeyValueList.ts";
import { OtlpConfiguration } from "../domain/telemetry/OtlpConfiguration.ts";
import { TelemetryResource } from "../domain/telemetry/TelemetryResource.ts";
import { PackageInfo } from "./PackageInfo.ts";

type Env = Record<string, string | undefined>;

// Lectura de las variables OTEL_* estándar; la validación la hace el dominio.
export class TelemetryEnvironment {
  private constructor() {}

  static configuration(env: Env): OtlpConfiguration {
    return OtlpConfiguration.fromEnvironment({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, headers: env.OTEL_EXPORTER_OTLP_HEADERS, timeout: env.OTEL_EXPORTER_OTLP_TIMEOUT });
  }

  // Una OTEL_RESOURCE_ATTRIBUTES mal formada se ignora entera: el recurso propio sigue saliendo.
  static resource(env: Env, project: Project): TelemetryResource {
    let extra = OtelKeyValueList.EMPTY;
    try { extra = OtelKeyValueList.parse(env.OTEL_RESOURCE_ATTRIBUTES ?? ""); } catch { extra = OtelKeyValueList.EMPTY; }
    return TelemetryResource.of(PackageInfo.version(), project.id, extra);
  }
}
```

`src/application/dto/SessionStatusDto.ts` (contenido completo):

```ts
import type { ExporterStatusDto } from "./ExporterStatusDto.ts";
import type { QualityKpisDto } from "./QualityKpisDto.ts";
import type { SessionSummaryDto } from "./SessionSummaryDto.ts";

// Estado de una sesión para /underpass-status: su resumen (null si el log no la conoce),
// la posición global del log, si la cadena de su stream está íntegra (una sesión sin
// eventos cuenta como íntegra), sus KPIs y el estado del exportador OTLP. kpis y exporter
// son opcionales: un host de una versión anterior no los envía.
export type SessionStatusDto = {
  summary: SessionSummaryDto | null;
  logPosition: number;
  sessionChainIntact: boolean;
  kpis?: QualityKpisDto | null;
  exporter?: ExporterStatusDto;
};
```

`src/application/use-cases/ReadSessionStatus.ts` (contenido completo):

```ts
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { StreamVerifier } from "../../domain/events/StreamVerifier.ts";
import type { ExporterStatusDto } from "../dto/ExporterStatusDto.ts";
import type { SessionStatusDto } from "../dto/SessionStatusDto.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { QualityKpisReport } from "./QualityKpisReport.ts";
import type { ReadSessionSummary } from "./ReadSessionSummary.ts";

// Sólo verifica el stream de la sesión pedida, no el log entero: es barato y es lo que
// /underpass-status necesita. KPIs y exportador sólo se añaden si se cablean.
export class ReadSessionStatus {
  readonly #events: EventStore; readonly #summaries: ReadSessionSummary;
  readonly #kpis: QualityKpisReport | null; readonly #exporter: (() => ExporterStatusDto) | null;
  constructor(events: EventStore, summaries: ReadSessionSummary, kpis: QualityKpisReport | null = null, exporter: (() => ExporterStatusDto) | null = null) {
    this.#events = events; this.#summaries = summaries; this.#kpis = kpis; this.#exporter = exporter;
  }

  execute(id: SessionId): SessionStatusDto {
    const summary = this.#summaries.execute(id);
    const verification = StreamVerifier.verify(this.#events.readStream(StreamId.session(id)));
    const status: SessionStatusDto = { summary, logPosition: this.#events.lastPosition().value, sessionChainIntact: verification.kind !== "broken" };
    if (this.#kpis !== null) status.kpis = this.#kpis.execute(id);
    if (this.#exporter !== null) status.exporter = this.#exporter();
    return status;
  }
}
```

`src/adapters/inbound/pi/HostExtension.ts`: añade, junto a `isOurs`,

```ts
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(0)}%`);
```

y, en el handler de `underpass-status`, sustituye la línea que añade `log: position …` por:

```ts
            lines.push(`log: position ${status.logPosition}, session chain ${status.sessionChainIntact ? "intact" : "BROKEN"}`);
            const k = status.kpis;
            if (k) lines.push(`kpis: first-try ${pct(k.firstTrySuccess)}, refusals ${pct(k.refusalRate)}, cache ${pct(k.cacheRatio)}, compactions ${k.compactions}`);
            const x = status.exporter;
            if (x) lines.push(x.state === "disabled" ? "otlp: disabled" : x.state === "ok" ? `otlp: ok, lag ${x.lag}` : `otlp: failing since ${x.since}`);
```

`src/composition/HostComposition.ts` (contenido completo):

```ts
import { join } from "node:path";
import { FsOwnerLock } from "../adapters/outbound/fs/FsOwnerLock.ts";
import { FsFingerprintRepository } from "../adapters/outbound/fs/FsFingerprintRepository.ts";
import { FsOrphanSpoolSource } from "../adapters/outbound/fs/FsOrphanSpoolSource.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { UnixSocketHostServer } from "../adapters/inbound/ipc/UnixSocketHostServer.ts";
import { JsonLineLogger } from "../adapters/outbound/log/JsonLineLogger.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { SystemClock } from "../adapters/outbound/clock/SystemClock.ts";
import { OtlpHttpTelemetrySink } from "../adapters/outbound/otlp/OtlpHttpTelemetrySink.ts";
import { OtlpJsonMapper } from "../adapters/outbound/otlp/OtlpJsonMapper.ts";
import { SqliteDatabase } from "../adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { SqliteTelemetryEpochStore } from "../adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { LazyMadeServerCommandFactory } from "../adapters/outbound/process/LazyMadeServerCommandFactory.ts";
import type { Clock } from "../application/ports/Clock.ts";
import type { EventStore } from "../application/ports/EventStore.ts";
import type { HostLog } from "../application/ports/HostLog.ts";
import type { Projection } from "../application/ports/Projection.ts";
import type { ProjectionStore } from "../application/ports/ProjectionStore.ts";
import type { ServerCommandFactory } from "../application/ports/ServerCommandFactory.ts";
import type { ServerLifecycleListener } from "../application/ports/ServerLifecycleListener.ts";
import { QualityKpisProjection } from "../application/projections/QualityKpisProjection.ts";
import { SessionSummaryProjection } from "../application/projections/SessionSummaryProjection.ts";
import { TelemetryMetricsProjection } from "../application/projections/TelemetryMetricsProjection.ts";
import { ToolStatsProjection } from "../application/projections/ToolStatsProjection.ts";
import { ExporterHealth } from "../application/services/ExporterHealth.ts";
import { HostFactFactory } from "../application/services/HostFactFactory.ts";
import { OrphanSpoolAdoption } from "../application/services/OrphanSpoolAdoption.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
import { ServerPool } from "../application/services/ServerPool.ts";
import { TelemetryEpochs } from "../application/services/TelemetryEpochs.ts";
import { TelemetryExporter } from "../application/services/TelemetryExporter.ts";
import { AdoptOrphanSpools } from "../application/use-cases/AdoptOrphanSpools.ts";
import { MetricsExport } from "../application/use-cases/MetricsExport.ts";
import { QualityKpisReport } from "../application/use-cases/QualityKpisReport.ts";
import { ReadSessionSummary } from "../application/use-cases/ReadSessionSummary.ts";
import { ReadSessionStatus } from "../application/use-cases/ReadSessionStatus.ts";
import { ReadTelemetryMetrics } from "../application/use-cases/ReadTelemetryMetrics.ts";
import { RecordFact } from "../application/use-cases/RecordFact.ts";
import { ServeHostRequest } from "../application/use-cases/ServeHostRequest.ts";
import { TraceExport } from "../application/use-cases/TraceExport.ts";
import { BinaryName } from "../domain/distribution/BinaryName.ts";
import type { Fact } from "../domain/events/Fact.ts";
import type { CatalogFingerprint } from "../domain/mcp/CatalogFingerprint.ts";
import type { Project } from "../domain/project/Project.ts";
import { TraceId } from "../domain/telemetry/TraceId.ts";
import { PackageInfo } from "./PackageInfo.ts";
import { RepoFile } from "./RepoFile.ts";
import { StatePaths } from "./StatePaths.ts";
import { TelemetryEnvironment } from "./TelemetryEnvironment.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class HostComposition {
  static async run(projectCwd: string, env: Record<string, string | undefined>, commands?: Map<string, ServerCommandFactory>): Promise<void> {
    const project = new GitProjectLocator().locate(projectCwd);
    const paths = new StatePaths(env);
    const lock = new FsOwnerLock(paths.projectDir(project)).acquire();
    if (!lock.owned) return;

    // host.log es JSON por líneas con rotación (JsonLineLogger); stdout/stderr del proceso
    // van a host.stderr.log. Un fallo al registrar nunca tumba el host.
    const clock = new SystemClock();
    const log = new JsonLineLogger(paths.hostLogOf(project), clock);
    const db = SqliteDatabase.open(paths.eventLogOf(project));
    const events = new SqliteEventStore(db);
    const projectionStore = new SqliteProjectionStore(db);
    const runner = new ProjectionRunner(events, projectionStore, HostComposition.projections());
    const record = new RecordFact(events, clock, () => runner.runOnce(), (e) => log.error("projections failed", { error: message(e) }));
    const hostFacts = new HostFactFactory(clock, String(process.pid));
    const safeRecord = (f: Fact) => {
      try { record.execute(f); }
      catch (e) { log.error("event log append failed", { error: message(e), type: f.type.value, trace_id: f.stream.isSession() ? TraceId.forStream(f.stream).value : null }); }
    };
    const listener: ServerLifecycleListener = { started: (s, id) => safeRecord(hostFacts.serverStarted(s, id)), exited: (s, code) => safeRecord(hostFacts.serverExited(s, code)) };

    const pool = new ServerPool(project, new StdioMcpConnector(60_000), commands ?? HostComposition.commands(env, paths), listener);
    const telemetry = HostComposition.#exporter(env, project, events, projectionStore, db, clock, log);
    const status = new ReadSessionStatus(events, new ReadSessionSummary(projectionStore, () => runner.runOnce()), new QualityKpisReport(projectionStore),
      () => telemetry?.status() ?? { state: "disabled", lag: 0, since: null });
    const serve = new ServeHostRequest(project, pool, record, status);
    const server = await UnixSocketHostServer.start(paths.socketOf(project), (req) => serve.execute(req));
    safeRecord(hostFacts.hostStarted(PackageInfo.version(), process.pid, HostComposition.#catalogs(paths)));
    // El inicio del acumulado de métricas se fija con la primera proyección y sobrevive a los reinicios.
    try { runner.runOnce(); new TelemetryEpochs(new SqliteTelemetryEpochStore(db), clock).current(); }
    catch (e) { log.error("telemetry projections failed", { error: message(e) }); }
    // Spools de procesos de Pi muertos: se adoptan al arrancar y en cada tick,
    // con retroceso por fichero para los que fallan (ver OrphanSpoolAdoption).
    const orphans = new OrphanSpoolAdoption(new AdoptOrphanSpools(new FsOrphanSpoolSource(paths.spoolDirOf(project)), record), clock, (line) => log.info(line));
    const adopt = () => { try { orphans.tick(); } catch (e) { log.error("fact spool adoption failed", { error: message(e) }); } };
    adopt();
    void telemetry?.tickTraces();

    const idleMs = Number(env.UNDERPASS_HOST_IDLE_MS ?? 60_000);
    let idleSince = Date.now();
    const projectionTimer = setInterval(() => {
      adopt();
      try { runner.runOnce(); } catch (e) { log.error("projections failed", { error: message(e) }); }
      void telemetry?.tickTraces();
    }, 5_000);
    // Métricas: snapshot acumulado cada 15 s, sin cola (un fallo lo cubre el siguiente).
    const metricsTimer = setInterval(() => { void telemetry?.tickMetrics(); }, 15_000);
    let stopping = false;
    // host.stopped se registra tras cerrar el pool (y con él los server.exited); la última
    // exportación va después y siempre antes de cerrar la base de datos.
    const shutdown = async (reason: "idle" | "signal") => {
      clearInterval(timer); clearInterval(projectionTimer); clearInterval(metricsTimer);
      try { await server.close(); await pool.close(); safeRecord(hostFacts.hostStopped(reason)); runner.runOnce(); await telemetry?.flush(); }
      finally { db.close(); lock.release(); }
    };
    const finish = (reason: "idle" | "signal") => {
      if (stopping) return;
      stopping = true;
      void shutdown(reason).then(() => process.exit(0)).catch(() => process.exit(1));
    };
    const timer = setInterval(() => {
      if (server.clients() > 0) idleSince = Date.now();
      else if (Date.now() - idleSince >= idleMs) finish("idle");
    }, Math.max(100, Math.min(1000, idleMs / 2)));
    process.once("SIGTERM", () => finish("signal"));
  }

  // Las proyecciones del host (EventLogComposition declara la misma lista para el CLI).
  static projections(): Projection[] { return [new SessionSummaryProjection(), new ToolStatsProjection(), new TelemetryMetricsProjection(), new QualityKpisProjection()]; }

  // Exportador OTLP: sólo con OTEL_EXPORTER_OTLP_ENDPOINT válida. Una configuración
  // inválida lo desactiva y se avisa una vez (sin repetir endpoint ni cabeceras).
  static #exporter(env: Record<string, string | undefined>, project: Project, events: EventStore, store: ProjectionStore, db: SqliteDatabase, clock: Clock, log: HostLog): TelemetryExporter | null {
    const configuration = TelemetryEnvironment.configuration(env);
    if (configuration.state === "invalid") log.warn("otlp exporter disabled: invalid configuration", { reason: configuration.problem });
    if (configuration.settings === null) return null;
    const resource = TelemetryEnvironment.resource(env, project);
    const sink = new OtlpHttpTelemetrySink(configuration.settings, new OtlpJsonMapper(PackageInfo.version()));
    const metrics = new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new SqliteTelemetryEpochStore(db), clock), sink, resource, clock);
    return new TelemetryExporter(new TraceExport(events, store, sink, resource), metrics, new ExporterHealth(log), clock);
  }

  // Huellas de catálogo que el host ya conoce (las que registró `underpass
  // setup`/doctor): sólo id de servidor y sha256. Sin fichero legible, vacío.
  static #catalogs(paths: StatePaths): Map<string, CatalogFingerprint> {
    try { return new FsFingerprintRepository(paths.fingerprintsFile()).load(); } catch { return new Map(); }
  }

  // Cableado de producción de los servidores del host (público para probarlo).
  static commands(env: Record<string, string | undefined>, paths: StatePaths): Map<string, ServerCommandFactory> {
    const pins = new JsonPinSetSource(RepoFile.path("pins.json")).load();
    const bin = (n: BinaryName) => join(paths.binDir(), pins.pinFor(n).installedFileName());
    const made = new LazyMadeServerCommandFactory(bin(BinaryName.MADE), paths.madeStore(), new FsMadeConfigurationRepository(paths.madeConfigRoot()), env);
    return new Map<string, ServerCommandFactory>([["kmp", new KmpServerCommandFactory(bin(BinaryName.KMP), env)], ["made", made]]);
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %. El test del host tarda unos segundos (espera al apagado por inactividad y a la exportación final).

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(host): proyecciones de telemetría, exportador OTLP, log JSON y KPIs y exportador en /underpass-status"
```

---

### Task 13: Checks de `doctor` — proyecciones de telemetría y exportador OTLP

**Files:**
- Create: `src/application/use-cases/DiagnoseTelemetry.ts`
- Modify: `src/domain/diagnosis/CheckSection.ts` (+`TELEMETRY`), `src/composition/EventLogComposition.ts`, `src/composition/CliComposition.ts`
- Test: `tests/unit/application/use-cases/DiagnoseTelemetry.test.ts`; añadir casos a `tests/unit/domain/diagnosis/diagnosis.test.ts` y `tests/unit/composition/EventLogComposition.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6 (`TraceExport.NAME/VERSION`), 8 (`OtlpConfiguration`), 10, 12 (`TelemetryEnvironment`); E1 `Check`, `CheckName`, `CheckDetail`, `DiagnoseInstallation` (añade al final lo que devuelva `eventLog.execute()`).
- Produces:
  - `CheckSection.TELEMETRY` (`telemetry`)
  - `new DiagnoseTelemetry(events, store, configuration: OtlpConfiguration, clock)`, `.execute(): Check[]` con `telemetry projections` y `otlp exporter`
  - `new EventLogComposition(paths, project, print, telemetry: OtlpConfiguration = OtlpConfiguration.DISABLED)`; `diagnosis()` devuelve los checks de E1 y después los de telemetría

Reglas (spec §6): `telemetry projections` OK si `telemetry_metrics` y `quality_kpis` están al día y sin cuarentena (WARN si no); `otlp exporter`: `OK disabled` sin endpoint; `OK` al día (con el lag y sólo el tipo de endpoint y los **nombres** de las cabeceras); `WARN` si el evento más antiguo sin exportar tiene más de 5 min; `FAIL` si la configuración es inválida (endpoint no HTTPS fuera de localhost, cabeceras o timeout mal formados), sin repetir la entrada.

- [ ] **Step 1: Tests que fallan**

`tests/unit/application/use-cases/DiagnoseTelemetry.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { QualityKpisProjection } from "../../../../src/application/projections/QualityKpisProjection.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { DiagnoseTelemetry } from "../../../../src/application/use-cases/DiagnoseTelemetry.ts";
import { TraceExport } from "../../../../src/application/use-cases/TraceExport.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../../src/domain/events/ProjectionCursor.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { OtlpConfiguration } from "../../../../src/domain/telemetry/OtlpConfiguration.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

function world() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("session.closed", "x", {}, SESSION, 2000)], AT);
  return { events, store };
}
const view = (c: { section: { value: string }; status: { value: string }; name: { value: string }; detail: { value: string } }) => [c.section.value, c.status.value, c.name.value, c.detail.value];

test("sin log: proyecciones OK y exportador desactivado", () => {
  const checks = new DiagnoseTelemetry(new InMemoryEventStore(), new InMemoryProjectionStore(), OtlpConfiguration.DISABLED, new ManualClock(0)).execute();
  assert.deepEqual(checks.map(view), [["telemetry", "OK", "telemetry projections", "no events yet"], ["telemetry", "OK", "otlp exporter", "disabled"]]);
});

test("proyecciones sin construir, atrasadas o con cuarentena: WARN con el remedio", () => {
  const { events, store } = world();
  const d = () => new DiagnoseTelemetry(events, store, OtlpConfiguration.DISABLED, new ManualClock(0)).execute()[0];
  assert.equal(d().status.value, "WARN");
  assert.match(d().detail.value, /telemetry_metrics not built yet; quality_kpis not built yet; start pi in this project or run underpass events rebuild <projection>/);
  new ProjectionRunner(events, store, [new TelemetryMetricsProjection(), new QualityKpisProjection()]).runOnce();
  assert.deepEqual([d().status.value, d().detail.value], ["OK", "up to date"]);
  events.append(SESSION, events.head(SESSION)!.version, [fact("session.opened", "o2")], AT);
  assert.match(d().detail.value, /telemetry_metrics at 2\/3; quality_kpis at 2\/3/);
  store.quarantine(QualityKpisProjection.NAME, GlobalPosition.of(1), "boom");
  assert.match(d().detail.value, /quality_kpis has 1 quarantined events/);
});

test("exportador: FAIL si la configuración es inválida, OK al día, WARN con más de 5 min de atraso; sólo nombres de cabeceras", () => {
  const { events, store } = world();
  const invalid = new DiagnoseTelemetry(events, store, OtlpConfiguration.fromEnvironment({ endpoint: "http://collector.internal:4318" }), new ManualClock(0)).execute()[1];
  assert.equal(invalid.status.value, "FAIL");
  assert.match(invalid.detail.value, /https:\/\/ outside localhost/);
  assert.equal(invalid.detail.value.includes("collector.internal"), false);
  const enabled = OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", headers: "authorization=Bearer%20t0p" });
  const at = (ms: number) => new DiagnoseTelemetry(events, store, enabled, new ManualClock(ms)).execute()[1];
  assert.deepEqual(view(at(AT.epochMs() + 60_000)), ["telemetry", "OK", "otlp exporter", "lag 2 (localhost endpoint, headers: authorization)"]);
  const late = at(AT.epochMs() + 6 * 60_000);
  assert.equal(late.status.value, "WARN");
  assert.match(late.detail.value, /^2 events not exported for 6 min \(localhost endpoint, headers: authorization\)/);
  assert.equal(late.detail.value.includes("t0p"), false);
  store.commit(TraceExport.NAME, ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.START), ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.of(2)), new Map());
  assert.deepEqual(view(at(AT.epochMs() + 6 * 60_000)), ["telemetry", "OK", "otlp exporter", "up to date (localhost endpoint, headers: authorization)"]);
});
```

En `tests/unit/domain/diagnosis/diagnosis.test.ts`, en el test que ya prueba `CheckSection.of("db")`, añade:

```ts
  assert.ok(CheckSection.of("telemetry").equals(CheckSection.TELEMETRY));
```

Al final de `tests/unit/composition/EventLogComposition.test.ts` (añade el import de `OtlpConfiguration`):

```ts
test("doctor añade la sección telemetry; un endpoint inválido es FAIL sin repetirlo", () => {
  const home = mkdtempSync(join(tmpdir(), "underpass-evlog-"));
  const paths = new StatePaths({ HOME: home, XDG_STATE_HOME: join(home, "state") });
  const composition = new EventLogComposition(paths, Project.of(ProjectRoot.of(home)), () => {}, OtlpConfiguration.fromEnvironment({ endpoint: "http://collector.internal:4318" }));
  const checks = composition.diagnosis().execute().filter((c) => c.section.value === "telemetry");
  assert.deepEqual(checks.map((c) => [c.name.value, c.status.value]), [["telemetry projections", "OK"], ["otlp exporter", "FAIL"]]);
  assert.equal(checks[1].detail.value.includes("collector.internal"), false);
  assert.deepEqual(setup().composition.diagnosis().execute().filter((c) => c.section.value === "telemetry").map((c) => c.detail.value), ["no events yet", "disabled"]);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/application/use-cases/DiagnoseTelemetry.test.ts`
Expected: FAIL por `Cannot find module …/DiagnoseTelemetry.ts`.

- [ ] **Step 3: Implementar**

`src/domain/diagnosis/CheckSection.ts` (contenido completo):

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CheckSection extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly PI = new CheckSection("pi");
  static readonly KMP = new CheckSection("kmp");
  static readonly MADE = new CheckSection("made");
  static readonly HOST = new CheckSection("host");
  static readonly EVENTS = new CheckSection("events");
  static readonly TELEMETRY = new CheckSection("telemetry");
  static of(raw: string): CheckSection {
    if (typeof raw !== "string") throw DomainError.because(`unknown check section ${raw}`);
    const found = [CheckSection.PI, CheckSection.KMP, CheckSection.MADE, CheckSection.HOST, CheckSection.EVENTS, CheckSection.TELEMETRY].find((s) => s.value === raw);
    if (!found) throw DomainError.because(`unknown check section ${raw}`);
    return found;
  }
}
```

`src/application/use-cases/DiagnoseTelemetry.ts`:

```ts
import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { OtlpConfiguration } from "../../domain/telemetry/OtlpConfiguration.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { QualityKpisProjection } from "../projections/QualityKpisProjection.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";
import { TraceExport } from "./TraceExport.ts";

const S = CheckSection.TELEMETRY;
const STALE_MS = 5 * 60_000;
const ok = (n: string, d: string) => Check.ok(S, CheckName.of(n), CheckDetail.of(d));
const warn = (n: string, d: string) => Check.warn(S, CheckName.of(n), CheckDetail.of(d));
const fail = (n: string, d: string) => Check.fail(S, CheckName.of(n), CheckDetail.of(d));

// Los dos checks de O1 en doctor. Nunca muestra el endpoint ni valores de cabeceras:
// sólo el tipo de endpoint (localhost o https) y los nombres de las cabeceras.
export class DiagnoseTelemetry {
  readonly #events: EventStore; readonly #store: ProjectionStore; readonly #configuration: OtlpConfiguration; readonly #clock: Clock;
  constructor(events: EventStore, store: ProjectionStore, configuration: OtlpConfiguration, clock: Clock) {
    this.#events = events; this.#store = store; this.#configuration = configuration; this.#clock = clock;
  }

  execute(): Check[] { return [this.#projections(), this.#exporter()]; }

  #projections(): Check {
    const last = this.#events.lastPosition().value;
    const problems: string[] = [];
    const list: Projection[] = [new TelemetryMetricsProjection(), new QualityKpisProjection()];
    for (const p of list) {
      const quarantined = this.#store.quarantined(p.name).length;
      if (quarantined > 0) problems.push(`${p.name.value} has ${quarantined} quarantined events`);
      if (last === 0) continue;
      const c = this.#store.cursor(p.name);
      if (c === null || c.version !== p.version) problems.push(`${p.name.value} not built yet`);
      else if (c.position.value < last) problems.push(`${p.name.value} at ${c.position.value}/${last}`);
    }
    if (problems.length > 0) return warn("telemetry projections", `${problems.join("; ")}; start pi in this project or run underpass events rebuild <projection>`);
    return ok("telemetry projections", last === 0 ? "no events yet" : "up to date");
  }

  #exporter(): Check {
    const c = this.#configuration;
    if (c.state === "disabled") return ok("otlp exporter", "disabled");
    if (c.settings === null) return fail("otlp exporter", `${c.problem ?? "invalid configuration"}; export is disabled`);
    const headers = c.settings.headers.names();
    const target = `${c.settings.endpoint.describe()} endpoint${headers.length > 0 ? `, headers: ${headers.join(", ")}` : ""}`;
    const cursor = this.#store.cursor(TraceExport.NAME);
    const from = cursor !== null && cursor.version === TraceExport.VERSION ? cursor.position : GlobalPosition.START;
    const [pending] = this.#events.readAll(from, 1);
    if (pending === undefined) return ok("otlp exporter", `up to date (${target})`);
    const lag = this.#events.lastPosition().value - from.value;
    const behindMs = this.#clock.now().epochMs() - pending.record.recordedAt.epochMs();
    return behindMs > STALE_MS
      ? warn("otlp exporter", `${lag} events not exported for ${Math.floor(behindMs / 60_000)} min (${target}); check that the host is running and the collector is reachable`)
      : ok("otlp exporter", `lag ${lag} (${target})`);
  }
}
```

`src/composition/EventLogComposition.ts` (contenido completo, con lo de las Tasks 9 y 10):

```ts
import { existsSync, readFileSync } from "node:fs";
import { EventsCli } from "../adapters/inbound/cli/EventsCli.ts";
import { MetricsCli } from "../adapters/inbound/cli/MetricsCli.ts";
import { SystemClock } from "../adapters/outbound/clock/SystemClock.ts";
import { FsSpoolGapMarkers } from "../adapters/outbound/fs/FsSpoolGapMarkers.ts";
import { FsSpoolInspector } from "../adapters/outbound/fs/FsSpoolInspector.ts";
import { InMemoryEventStore } from "../adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { SqliteDatabase } from "../adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { SqliteTelemetryEpochStore } from "../adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import type { EventStore } from "../application/ports/EventStore.ts";
import type { Projection } from "../application/ports/Projection.ts";
import type { ProjectionStore } from "../application/ports/ProjectionStore.ts";
import type { TelemetryEpochStore } from "../application/ports/TelemetryEpochStore.ts";
import { QualityKpisProjection } from "../application/projections/QualityKpisProjection.ts";
import { SessionSummaryProjection } from "../application/projections/SessionSummaryProjection.ts";
import { TelemetryMetricsProjection } from "../application/projections/TelemetryMetricsProjection.ts";
import { ToolStatsProjection } from "../application/projections/ToolStatsProjection.ts";
import { ProjectionRunner } from "../application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../application/services/TelemetryEpochs.ts";
import { AcknowledgeSpoolGaps } from "../application/use-cases/AcknowledgeSpoolGaps.ts";
import { DiagnoseEventLog } from "../application/use-cases/DiagnoseEventLog.ts";
import { DiagnoseTelemetry } from "../application/use-cases/DiagnoseTelemetry.ts";
import { ExportEventLog } from "../application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../application/use-cases/ImportEventLog.ts";
import { ListSessions } from "../application/use-cases/ListSessions.ts";
import { ProjectionLag } from "../application/use-cases/ProjectionLag.ts";
import { QualityKpisReport } from "../application/use-cases/QualityKpisReport.ts";
import { ReadTelemetryMetrics } from "../application/use-cases/ReadTelemetryMetrics.ts";
import { RebuildProjection } from "../application/use-cases/RebuildProjection.ts";
import { SessionTrace } from "../application/use-cases/SessionTrace.ts";
import { ShowSession } from "../application/use-cases/ShowSession.ts";
import { ToolStatsReport } from "../application/use-cases/ToolStatsReport.ts";
import { VerifyEventLog } from "../application/use-cases/VerifyEventLog.ts";
import type { Check } from "../domain/diagnosis/Check.ts";
import type { Project } from "../domain/project/Project.ts";
import { OtlpConfiguration } from "../domain/telemetry/OtlpConfiguration.ts";
import { LazyEventStore } from "./LazyEventStore.ts";
import { LazyProjectionStore } from "./LazyProjectionStore.ts";
import type { StatePaths } from "./StatePaths.ts";

// read: sólo lectura (doctor y consultas); write: lectura-escritura si el log existe (rebuild); create: lo crea (import).
type Mode = "read" | "write" | "create";
type Stores = { events: EventStore; projections: ProjectionStore; epochs: TelemetryEpochStore; persisted: boolean };

// Cableado del log de eventos para el CLI. Sin log, lectura y rebuild trabajan sobre almacenes vacíos en memoria:
// nada se crea salvo con `events import`, y aun entonces sólo tras validar el bundle.
export class EventLogComposition {
  readonly #log: string; readonly #spool: string; readonly #project: Project; readonly #print: (s: string) => void; readonly #telemetry: OtlpConfiguration;
  constructor(paths: StatePaths, project: Project, print: (s: string) => void, telemetry: OtlpConfiguration = OtlpConfiguration.DISABLED) {
    this.#log = paths.eventLogOf(project); this.#spool = paths.spoolDirOf(project); this.#project = project; this.#print = print; this.#telemetry = telemetry;
  }

  diagnosis(): { execute(): Check[] } {
    return {
      execute: () => {
        const s = this.#open("read");
        // Sin log no hay cursores que comparar: la lista vacía evita un falso "version mismatch".
        return [
          ...new DiagnoseEventLog(s.events, s.projections, s.persisted ? this.#projections() : [], new FsSpoolInspector(this.#spool)).execute(),
          ...new DiagnoseTelemetry(s.events, s.projections, this.#telemetry, new SystemClock()).execute(),
        ];
      },
    };
  }

  cli(): { run(args: string[]): number } {
    return {
      run: (args: string[]) => {
        const mode: Mode = args[0] === "import" ? "create" : args[0] === "rebuild" ? "write" : "read";
        let stores: Stores | null = null;
        const resolve = () => (stores ??= this.#open(mode));
        const events = new LazyEventStore(() => resolve().events); const projections = new LazyProjectionStore(() => resolve().projections);
        return new EventsCli({
          sessions: new ListSessions(projections), show: new ShowSession(events), tools: new ToolStatsReport(projections),
          kpis: new QualityKpisReport(projections), trace: new SessionTrace(events), metrics: new ReadTelemetryMetrics(events, projections),
          verify: new VerifyEventLog(events), exportLog: new ExportEventLog(events, this.#project.id), importLog: new ImportEventLog(events, this.#project.id),
          rebuild: new RebuildProjection(new ProjectionRunner(events, projections, this.#projections()), projections, this.#epochs(resolve)),
          lag: new ProjectionLag(events, projections, this.#projections()), ackGaps: new AcknowledgeSpoolGaps(new FsSpoolGapMarkers(this.#spool)), readFile: (p) => readFileSync(p, "utf8"), print: this.#print,
        }).run(args);
      },
    };
  }

  metrics(): { run(args: string[]): number } {
    return {
      run: (args: string[]) => {
        let stores: Stores | null = null;
        const resolve = () => (stores ??= this.#open("read"));
        const events = new LazyEventStore(() => resolve().events); const projections = new LazyProjectionStore(() => resolve().projections);
        return new MetricsCli({ read: new ReadTelemetryMetrics(events, projections), lag: new ProjectionLag(events, projections, this.#projections()), print: this.#print }).run(args);
      },
    };
  }

  // Las mismas proyecciones que mantiene el host (HostComposition.projections()).
  #projections(): Projection[] { return [new SessionSummaryProjection(), new ToolStatsProjection(), new TelemetryMetricsProjection(), new QualityKpisProjection()]; }

  #epochs(resolve: () => Stores): TelemetryEpochs {
    return new TelemetryEpochs({ read: () => resolve().epochs.read(), write: (e) => resolve().epochs.write(e) }, new SystemClock());
  }

  #open(mode: Mode): Stores {
    if (mode !== "create" && !existsSync(this.#log)) return { events: new InMemoryEventStore(), projections: new InMemoryProjectionStore(), epochs: new InMemoryTelemetryEpochStore(), persisted: false };
    const db = mode === "read" ? SqliteDatabase.openReadOnly(this.#log) : SqliteDatabase.open(this.#log);
    return { events: new SqliteEventStore(db), projections: new SqliteProjectionStore(db), epochs: new SqliteTelemetryEpochStore(db), persisted: true };
  }
}
```

`src/composition/CliComposition.ts`: importa `TelemetryEnvironment` de `./TelemetryEnvironment.ts` y cambia la construcción del log de eventos por

```ts
    const eventLog = new EventLogComposition(paths, project, print, TelemetryEnvironment.configuration(env));
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %. El test de `EventLogComposition` "doctor sin log" sigue pasando: los checks de telemetría sin log salen OK.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(doctor): checks de proyecciones de telemetría y del exportador OTLP"
```

---

### Task 14: Artefactos de observabilidad (`deploy/observability/`)

**Files:**
- Create: `deploy/observability/pi-runtime.rules.yaml`, `deploy/observability/pi-runtime.dashboard.json`
- Test: `tests/unit/deploy/observability-artifacts.test.ts`

**Interfaces:**
- Consumes: Task 1 (`MetricCatalog.ALL`), Task 2 (la proyección sólo emite series del catálogo, por construcción de `MetricKey.of`).
- Produces: un `PrometheusRule` con las cuatro alertas de la spec §8 y un dashboard de Grafana que usa las diez métricas.

- [ ] **Step 1: Test que falla**

`tests/unit/deploy/observability-artifacts.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MetricCatalog } from "../../../src/domain/telemetry/MetricCatalog.ts";

const file = (name: string) => readFileSync(fileURLToPath(new URL(`../../../deploy/observability/${name}`, import.meta.url)), "utf8");
const KNOWN = new Set(MetricCatalog.ALL.flatMap((d) => (d.kind === "histogram" ? [`${d.name}_bucket`, `${d.name}_sum`, `${d.name}_count`] : [d.name])));
const referenced = (text: string) => [...new Set(text.match(/pi_runtime_[a-z_]+/g) ?? [])];

test("el dashboard de Grafana es JSON válido, sólo usa métricas del catálogo y las cubre todas", () => {
  const dash = JSON.parse(file("pi-runtime.dashboard.json")) as { uid: string; title: string; panels: { id: number; title: string; type: string; targets: { refId: string; expr: string }[] }[] };
  assert.deepEqual([dash.uid, dash.title], ["pi-runtime", "Pi Runtime"]);
  assert.ok(dash.panels.length >= 8);
  assert.equal(new Set(dash.panels.map((p) => p.id)).size, dash.panels.length);
  for (const p of dash.panels) {
    assert.ok(p.title && p.type && p.targets.length > 0, p.title);
    for (const t of p.targets) assert.ok(t.refId && t.expr, p.title);
  }
  const exprs = dash.panels.flatMap((p) => p.targets.map((t) => t.expr)).join("\n");
  assert.deepEqual(referenced(exprs).filter((m) => !KNOWN.has(m)), []);
  const covered = referenced(exprs).map((m) => m.replace(/_(bucket|sum|count)$/, ""));
  assert.deepEqual(MetricCatalog.ALL.map((d) => d.name).filter((n) => !covered.includes(n)), [], "el dashboard usa todas las métricas");
});

test("las reglas son un PrometheusRule bien formado con las cuatro alertas de la spec", () => {
  const text = file("pi-runtime.rules.yaml");
  assert.equal(/\t/.test(text), false, "YAML sin tabuladores");
  assert.match(text, /^apiVersion: monitoring\.coreos\.com\/v1\nkind: PrometheusRule\n/);
  for (const line of text.split("\n")) if (line.trim() !== "") assert.equal((line.length - line.trimStart().length) % 2, 0, `indentación par: ${line}`);
  const alerts = text.split(/\n\s*- alert: /).slice(1).map((block) => ({ name: block.split("\n")[0].trim(), block }));
  assert.deepEqual(alerts.map((a) => a.name), ["PiRuntimeToolFailureRateHigh", "PiRuntimeToolRefusalsHigh", "PiRuntimeToolLatencyP95High", "PiRuntimeTelemetryAbsent"]);
  assert.deepEqual(alerts.map((a) => /\n\s+for: (\S+)/.exec(a.block)?.[1]), ["10m", "10m", "10m", "30m"]);
  for (const a of alerts) {
    assert.match(a.block, /\n\s+expr: /, a.name);
    assert.match(a.block, /\n\s+severity: (warning|info)\n/, a.name);
    assert.match(a.block, /\n\s+summary: \S/, a.name);
  }
  assert.match(alerts[0].block, /status="failed"[\s\S]*> 0\.05/);
  assert.match(alerts[1].block, /pi_runtime_tool_refused_total\[10m\]\)\) > 0\.5/);
  assert.match(alerts[2].block, /histogram_quantile\(0\.95,[\s\S]*> 2000/);
  assert.match(alerts[3].block, /absent\(pi_runtime_sessions_total\)/);
  assert.deepEqual(referenced(text).filter((m) => !KNOWN.has(m)), []);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `node --disable-warning=ExperimentalWarning --test tests/unit/deploy/observability-artifacts.test.ts`
Expected: FAIL con `ENOENT … deploy/observability/pi-runtime.dashboard.json`.

- [ ] **Step 3: Crear los artefactos**

`deploy/observability/pi-runtime.rules.yaml`:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: pi-runtime
  labels:
    app.kubernetes.io/name: pi-runtime
    app.kubernetes.io/part-of: underpass
spec:
  groups:
    - name: pi-runtime.tools
      rules:
        - alert: PiRuntimeToolFailureRateHigh
          expr: |
            sum(rate(pi_runtime_tool_invocations_total{status="failed"}[10m]))
              / clamp_min(sum(rate(pi_runtime_tool_invocations_total[10m])), 1e-9) > 0.05
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: More than 5 % of tool invocations failed over the last 10 minutes
            description: Refused and aborted calls do not count as failures. Check failing tools by server in the Pi Runtime dashboard.
        - alert: PiRuntimeToolRefusalsHigh
          expr: sum(rate(pi_runtime_tool_refused_total[10m])) > 0.5
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: Tool calls are being refused more than 0.5 times per second
            description: Check refusal reasons by tool; a policy or schema change may be rejecting calls.
        - alert: PiRuntimeToolLatencyP95High
          expr: |
            histogram_quantile(0.95, sum by (le) (rate(pi_runtime_tool_duration_ms_bucket[10m]))) > 2000
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: Tool p95 latency above 2 seconds over the last 10 minutes
            description: Compare p50 and p95 by tool in the dashboard to find the slow tool or MCP server.
    - name: pi-runtime.presence
      rules:
        - alert: PiRuntimeTelemetryAbsent
          expr: absent(pi_runtime_sessions_total)
          for: 30m
          labels:
            severity: info
          annotations:
            summary: No pi-runtime session metrics received for 30 minutes
            description: Informational. Expected when nobody uses Pi or the OTLP exporter is disabled.
```

`deploy/observability/pi-runtime.dashboard.json`:

```json
{
  "__inputs": [{ "name": "DS_PROMETHEUS", "label": "Prometheus", "type": "datasource", "pluginId": "prometheus", "pluginName": "Prometheus" }],
  "uid": "pi-runtime",
  "title": "Pi Runtime",
  "tags": ["pi-runtime", "underpass"],
  "schemaVersion": 39,
  "version": 1,
  "editable": true,
  "refresh": "1m",
  "time": { "from": "now-24h", "to": "now" },
  "templating": { "list": [] },
  "annotations": { "list": [] },
  "panels": [
    {
      "id": 1, "type": "timeseries", "title": "Tool invocations by status",
      "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "ops" }, "overrides": [] },
      "targets": [{ "refId": "A", "expr": "sum by (status) (rate(pi_runtime_tool_invocations_total[$__rate_interval]))", "legendFormat": "{{status}}" }]
    },
    {
      "id": 2, "type": "timeseries", "title": "Tool refusals by reason",
      "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "ops" }, "overrides": [] },
      "targets": [{ "refId": "A", "expr": "sum by (tool, reason) (rate(pi_runtime_tool_refused_total[$__rate_interval]))", "legendFormat": "{{tool}} {{reason}}" }]
    },
    {
      "id": 3, "type": "timeseries", "title": "Tool latency p50 / p95 by tool",
      "gridPos": { "x": 0, "y": 8, "w": 24, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "ms" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "histogram_quantile(0.5, sum by (le, tool) (rate(pi_runtime_tool_duration_ms_bucket[$__rate_interval])))", "legendFormat": "p50 {{tool}}" },
        { "refId": "B", "expr": "histogram_quantile(0.95, sum by (le, tool) (rate(pi_runtime_tool_duration_ms_bucket[$__rate_interval])))", "legendFormat": "p95 {{tool}}" },
        { "refId": "C", "expr": "sum by (tool) (rate(pi_runtime_tool_duration_ms_sum[$__rate_interval])) / sum by (tool) (rate(pi_runtime_tool_duration_ms_count[$__rate_interval]))", "legendFormat": "mean {{tool}}" }
      ]
    },
    {
      "id": 4, "type": "timeseries", "title": "Tokens by model and kind",
      "gridPos": { "x": 0, "y": 16, "w": 12, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [{ "refId": "A", "expr": "sum by (model, kind) (increase(pi_runtime_tokens_total[$__rate_interval]))", "legendFormat": "{{model}} {{kind}}" }]
    },
    {
      "id": 5, "type": "timeseries", "title": "Cost by model",
      "gridPos": { "x": 12, "y": 16, "w": 12, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [{ "refId": "A", "expr": "sum by (model) (increase(pi_runtime_cost_total[$__rate_interval]))", "legendFormat": "{{model}}" }]
    },
    {
      "id": 6, "type": "timeseries", "title": "Turns by model and outcome",
      "gridPos": { "x": 0, "y": 24, "w": 12, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [{ "refId": "A", "expr": "sum by (model, outcome) (increase(pi_runtime_turns_total[$__rate_interval]))", "legendFormat": "{{model}} {{outcome}}" }]
    },
    {
      "id": 7, "type": "timeseries", "title": "Sessions",
      "gridPos": { "x": 12, "y": 24, "w": 6, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [{ "refId": "A", "expr": "sum by (event) (increase(pi_runtime_sessions_total[$__rate_interval]))", "legendFormat": "{{event}}" }]
    },
    {
      "id": 8, "type": "timeseries", "title": "Compactions",
      "gridPos": { "x": 18, "y": 24, "w": 6, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [{ "refId": "A", "expr": "sum by (reason) (increase(pi_runtime_compactions_total[$__rate_interval]))", "legendFormat": "{{reason}}" }]
    },
    {
      "id": 9, "type": "timeseries", "title": "MCP server starts and exits",
      "gridPos": { "x": 0, "y": 32, "w": 24, "h": 8 }, "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "sum by (server) (increase(pi_runtime_server_starts_total[$__rate_interval]))", "legendFormat": "start {{server}}" },
        { "refId": "B", "expr": "sum by (server, code) (increase(pi_runtime_server_exits_total[$__rate_interval]))", "legendFormat": "exit {{server}} {{code}}" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS (el test de artefactos está bajo `tests/unit/**`, así que `scripts/test.sh` lo recoge), cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add deploy/observability tests/unit/deploy
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "feat(observabilidad): PrometheusRule y dashboard de Grafana validados contra el catálogo"
```

---

### Task 15: Aceptación de O1 en la instalación real

**Files:**
- Create: `tests/acceptance/otlp-receiver.ts`, `tests/acceptance/otlp-inspect.ts`, `docs/acceptance/o1.md`

Todo se ejecuta desde este worktree (`/home/gx10a/Documents/ai/pi-runtime-o1`); `underpass update` registra este checkout como paquete `pi-runtime` de Pi. Los ficheros de prueba van a `/tmp/claude-o1-*`.

- [ ] **Step 1: Scripts de ayuda**

`tests/acceptance/otlp-receiver.ts`:

```ts
#!/usr/bin/env node
// Receptor OTLP/HTTP JSON de prueba para la aceptación de O1: guarda cada POST en
// <dir>/<n>-<traces|metrics>.json y responde 200. En consola, sólo tamaños y NOMBRES de cabeceras.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const [dir, port = "4318"] = process.argv.slice(2);
if (!dir) { console.error("usage: node tests/acceptance/otlp-receiver.ts <dir> [port]"); process.exit(2); }
mkdirSync(dir, { recursive: true });
let n = 0;
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const signal = req.url === "/v1/traces" ? "traces" : req.url === "/v1/metrics" ? "metrics" : "other";
    n++;
    writeFileSync(join(dir, `${String(n).padStart(4, "0")}-${signal}.json`), body);
    console.log(`${n} ${signal} ${body.length} bytes content-type=${req.headers["content-type"]} headers=${Object.keys(req.headers).sort().join(",")}`);
    res.writeHead(signal === "other" ? 404 : 200, { "content-type": "application/json" }).end("{}");
  });
}).listen(Number(port), "127.0.0.1", () => console.log(`otlp receiver on 127.0.0.1:${port} -> ${dir}`));
```

`tests/acceptance/otlp-inspect.ts`:

```ts
#!/usr/bin/env node
// Revisa lo que guardó otlp-receiver.ts: en cada traza con raíz (session u host cerrados),
// todo parentSpanId existe; cuenta spans únicos y métricas; y falla si aparece HOME, el
// hostname, el usuario o cualquiera de las cadenas prohibidas que se le pasen.
import { readdirSync, readFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";

type OtlpSpan = { traceId: string; spanId: string; parentSpanId?: string; name: string };
const [dir, ...forbidden] = process.argv.slice(2);
if (!dir) { console.error("usage: node tests/acceptance/otlp-inspect.ts <dir> [forbidden-string…]"); process.exit(2); }
const secrets = [homedir(), hostname(), userInfo().username, ...forbidden].filter((s) => s.length >= 4);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const spans: OtlpSpan[] = []; const metrics = new Set<string>(); const problems: string[] = [];
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  if (secrets.some((s) => text.includes(s))) problems.push(`${f} contains a forbidden string`);
  const body = JSON.parse(text) as { resourceSpans?: { scopeSpans: { spans: OtlpSpan[] }[] }[]; resourceMetrics?: { scopeMetrics: { metrics: { name: string }[] }[] }[] };
  for (const rs of body.resourceSpans ?? []) for (const ss of rs.scopeSpans) spans.push(...ss.spans);
  for (const rm of body.resourceMetrics ?? []) for (const sm of rm.scopeMetrics) for (const m of sm.metrics) metrics.add(m.name);
}
const ids = new Set(spans.map((s) => `${s.traceId}/${s.spanId}`));
const rooted = new Set(spans.filter((s) => s.parentSpanId === undefined).map((s) => s.traceId));
let openTraceSpans = 0;
for (const s of spans) {
  if (s.parentSpanId === undefined || ids.has(`${s.traceId}/${s.parentSpanId}`)) continue;
  if (rooted.has(s.traceId)) problems.push(`span ${s.name} ${s.spanId}: parent ${s.parentSpanId} missing in a closed trace`);
  else openTraceSpans++;
}
const byName: Record<string, number> = {};
for (const s of spans) byName[s.name] = (byName[s.name] ?? 0) + 1;
console.log(JSON.stringify({ files: files.length, spans: spans.length, uniqueSpans: ids.size, traces: new Set(spans.map((s) => s.traceId)).size,
  spansInOpenTraces: openTraceSpans, byName, metrics: [...metrics].sort() }, null, 2));
for (const p of problems) console.error(p);
process.exit(problems.length === 0 ? 0 : 1);
```

(`spansInOpenTraces` cuenta spans de sesiones que siguen abiertas en el log —p. ej. una sesión antigua cuyo Pi murió sin reabrirla—: su span de sesión no ha salido todavía y no es un error.)

- [ ] **Step 2: Tests, reinstalación y `doctor`**

```bash
cd /home/gx10a/Documents/ai/pi-runtime-o1 && npm test
pkill -f underpass-host.ts || true
node bin/underpass.ts update
node bin/underpass.ts doctor
```

Expected: `npm test` en verde; `doctor` exit 0 con una sección `[telemetry]` que dice `OK   otlp exporter — disabled` (y `telemetry projections` en OK o WARN "not built yet" hasta que el host las construya en el paso siguiente).

- [ ] **Step 3: Superficies locales sobre el log real de kmp**

Una sesión real con turnos y llamadas a `kmp_ask` (modelo `faux`, sin red; el script de E1 imprime el `sessionId` y el centinela que puso en los argumentos). El host arranca con el código de este worktree y reconstruye desde 0 las proyecciones nuevas:

```bash
cd /home/gx10a/Documents/ai/pi-runtime-o1
node tests/acceptance/spool-recovery.ts /home/gx10a/Documents/ai/kmp > /tmp/claude-o1-local.json
SID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sessionId)' /tmp/claude-o1-local.json)
SENTINEL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sentinel)' /tmp/claude-o1-local.json)
cd /home/gx10a/Documents/ai/kmp
node /home/gx10a/Documents/ai/pi-runtime-o1/bin/underpass.ts metrics > /tmp/claude-o1-metrics.txt; head -40 /tmp/claude-o1-metrics.txt
node /home/gx10a/Documents/ai/pi-runtime-o1/bin/underpass.ts events kpis
node /home/gx10a/Documents/ai/pi-runtime-o1/bin/underpass.ts events kpis --session "$SID"
node /home/gx10a/Documents/ai/pi-runtime-o1/bin/underpass.ts events trace "$SID" | tee /tmp/claude-o1-trace.txt
grep -c -e "$SENTINEL" -e /home /tmp/claude-o1-metrics.txt /tmp/claude-o1-trace.txt
```

Expected:
- `spool-recovery.ts` exit 0.
- `metrics`: `# HELP`/`# TYPE` y series de `pi_runtime_sessions_total`, `pi_runtime_turns_total{…}`, `pi_runtime_tool_invocations_total{server="kmp",…,tool="kmp_ask"}` y `pi_runtime_tool_duration_ms_bucket{…,le="…"}`; ningún comentario `# projections behind`.
- `events kpis`: la tabla con `first-try`, `refusals`, `cache ratio`, `compactions` y una línea `latency      kmp/kmp_ask …`; con `--session`, `scope` es el id de la sesión.
- `events trace`: árbol `session` → `turn` → `tool` con duraciones, estados, tokens y coste por turno (la llamada hecha con el host caído sale `failed` o `aborted` según la vio Pi).
- `grep -c` da 0 en ambos ficheros: ni el centinela de los argumentos ni rutas.

- [ ] **Step 4: Exportación a un receptor OTLP local, con el host muerto a mitad de sesión**

```bash
rm -rf /tmp/claude-o1-otlp
node /home/gx10a/Documents/ai/pi-runtime-o1/tests/acceptance/otlp-receiver.ts /tmp/claude-o1-otlp 4318 &
pkill -f underpass-host.ts || true
cd /home/gx10a/Documents/ai/pi-runtime-o1
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20acceptance-o1-secret UNDERPASS_HOST_IDLE_MS=5000
node tests/acceptance/spool-recovery.ts /home/gx10a/Documents/ai/kmp > /tmp/claude-o1-export.json
unset OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_HEADERS UNDERPASS_HOST_IDLE_MS
SENTINEL2=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sentinel)' /tmp/claude-o1-export.json)
```

`spool-recovery.ts` mata el host durante la segunda llamada y el siguiente lo relanza con el mismo entorno: el exportador retoma su cursor y su estado del ensamblador desde el log. Espera a que el host se apague por inactividad (≈5 s tras cerrar la sesión; `pgrep -f underpass-host.ts` vacío). Después:

```bash
node tests/acceptance/otlp-inspect.ts /tmp/claude-o1-otlp acceptance-o1-secret "$SENTINEL" "$SENTINEL2" /home/gx10a/Documents/ai/kmp
```

Expected: exit 0; `byName` con `session`, `turn`, `tool`, `host` y `mcp_server`; `metrics` con los nombres del catálogo que tengan datos; el receptor imprimió `content-type=application/json` y `authorization` entre los nombres de cabeceras (nunca su valor). El primer arranque exportó todo el log histórico de kmp (cursor nuevo) y después la sesión nueva; hay al menos dos trazas `host`: el arranque que `pkill` (SIGTERM) apagó de forma ordenada, cerrado con `pi_runtime.stop_reason=signal`, y el relanzado.

Log del host en JSON y sin secretos (el id del proyecto es el sha256 de la raíz de kmp, truncado a 16):

```bash
ID=$(node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,16))' "$(realpath /home/gx10a/Documents/ai/kmp)")
node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");for(const l of t.trim().split("\n"))JSON.parse(l);if(t.includes("acceptance-o1-secret")||t.includes(require("os").homedir()))process.exit(1);console.log("host.log ok,",t.trim().split("\n").length,"lines")' ~/.local/state/pi-runtime/projects/$ID/host.log
ls ~/.local/state/pi-runtime/projects/$ID/
```

Expected: `host.log ok, N lines` (exit 0) y, junto a `host.log`, un `host.stderr.log`.

- [ ] **Step 5: Reexportación sin ids nuevos**

```bash
node /home/gx10a/Documents/ai/pi-runtime-o1/tests/acceptance/otlp-inspect.ts /tmp/claude-o1-otlp | grep -E '"(spans|uniqueSpans)"'
cd /home/gx10a/Documents/ai/kmp && node /home/gx10a/Documents/ai/pi-runtime-o1/bin/underpass.ts events rebuild otlp_traces
cd /home/gx10a/Documents/ai/pi-runtime-o1
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20acceptance-o1-secret UNDERPASS_HOST_IDLE_MS=5000 \
  node tests/acceptance/load-extensions.ts /home/gx10a/Documents/ai/kmp
```

Espera al apagado del host y repite el `otlp-inspect … | grep`.

Expected: `spans` casi se duplica (se reenvió todo el log), pero `uniqueSpans` sólo crece con los spans nuevos de esta última ejecución (su sesión, su `host` y sus `mcp_server`): la reexportación no creó ids nuevos para lo ya enviado.

- [ ] **Step 6: `doctor` con el exportador activo y con un endpoint inválido**

```bash
cd /home/gx10a/Documents/ai/kmp
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20acceptance-o1-secret node /home/gx10a/Documents/ai/pi-runtime-o1/bin/underpass.ts doctor
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.example.com:4318 node /home/gx10a/Documents/ai/pi-runtime-o1/bin/underpass.ts doctor; echo "exit $?"
pkill -f otlp-receiver.ts
```

Expected: el primero, exit 0 con `OK   otlp exporter — up to date (localhost endpoint, headers: authorization)` (o `lag N` pequeño) y `OK   telemetry projections — up to date`; `acceptance-o1-secret` no aparece. El segundo, `FAIL otlp exporter — OTEL_EXPORTER_OTLP_ENDPOINT must use https:// outside localhost…` sin `collector.example.com`, y `exit 1`.

- [ ] **Step 7: Registrar** en `docs/acceptance/o1.md` los comandos, las salidas relevantes (recortadas y sin contenido sensible: ni rutas de `$HOME` ni el valor de la cabecera), la fecha y las versiones (pi-runtime, Pi, Node). Commit:

```bash
git add tests/acceptance/otlp-receiver.ts tests/acceptance/otlp-inspect.ts docs/acceptance/o1.md
git -c user.name="Tirso" -c user.email="tgarciaib@gmail.com" commit -m "docs(o1): aceptación de la observabilidad en la instalación real"
```

---

## Cobertura de la spec

| Spec | Tareas |
|---|---|
| §0.1 local primero, OTLP opcional | 9, 10, 12 (sin endpoint no se construye el exportador), 13 |
| §0.2 señales (tools, modelo, sesión y host, KPIs) | 1, 2, 3, 5 |
| §0.3 alertas sólo como artefactos | 14 |
| §0.4 todo sale del log (proyecciones y cursor propio, reexportable) | 2, 3, 6, 7 (`rebuild otlp_traces`), 8 |
| §1 arquitectura (piezas y capas) | 1–12; gates de `tests/architecture/` en cada tarea |
| §2 métricas, almacenamiento, cardinalidad, inicio del acumulado | 1, 2, 7 (`meta.telemetry_start`, reinicio en rebuild) |
| §3 KPIs de calidad | 3, 10 (`events kpis`), 12 (`/underpass-status`) |
| §4 ids deterministas, spans, eventos, incompletos, host, recurso, estado persistido | 4, 5, 6 (`TelemetryResource`), 8 (reinicio en SQLite) |
| §5 exportación (activación, JSON, lotes de 512, 2xx/4xx/5xx/429, 15 s, CUMULATIVE, retroceso 1 s–5 min, aislamiento, cabeceras, timeout, idempotencia) | 6, 7, 8, 12 |
| §6 superficies locales (`metrics`, `events kpis`, `events trace`, `/underpass-status`, `doctor`) | 9, 10, 12, 13 |
| §7 log del host JSON con rotación | 11, 12 |
| §8 artefactos y su test | 14 |
| §9 errores (proyecciones tolerantes, exportador sin propagar, config inválida desactiva) | 2, 3, 7 (`#safely`), 12, 13 |
| §10 pruebas unitarias, integración con colector falso y aceptación | todas; 8 (colector falso: recepción, caída y reintento, 4xx, reexportación, reinicio a mitad de lote), 12 (host real), 15 |
| §11 fuera de alcance | no se implementa: ni evaluación local de alertas, ni KPIs de L1, ni muestreo, ni gRPC/protobuf, ni stack local |

## Decisiones tomadas donde la spec deja margen

1. **Inicio del acumulado (§2).** Las proyecciones son puras y sin reloj, así que no pueden fijar una hora. `telemetry_start` vive en `meta` como `{start, projectionVersion}` (puerto `TelemetryEpochStore`); el host lo fija tras la primera pasada de proyecciones al arrancar (y `MetricsExport` si faltara), sobrevive a los reinicios, y se reinicia con `underpass events rebuild telemetry_metrics` o cuando cambia la versión de `telemetry_metrics`. Así OTLP ve un reinicio de contador (otro `startTimeUnixNano`).
2. **Padre de las tools (§4).** Pi emite `turn_end` después de ejecutar las tools del turno, así que el turno "en curso" sólo se conoce en su `turn.completed`: el span de tool cerrado espera en el estado y sale con ese turno como padre; si antes se cierra o reabre la sesión, o pasan 10 min, sale colgado de la sesión.
3. **Fin de un span incompleto (§4).** Es el cierre de la sesión (o la reapertura) si llega antes; si no, `recordedAt` del `tool.started` + 10 min.
4. **`--session` en `underpass metrics` (§6).** Las métricas no llevan label de sesión (cardinalidad); el snapshot de una sesión se calcula reproduciendo sólo su stream con la misma proyección.
5. **p50/p95 locales (§2).** `events kpis` imprime una línea `latency` por tool con los cuantiles estimados por el histograma (límite superior del cubo).
6. **Nombres OTLP de las métricas (§5).** Los mismos que en Prometheus y `unit` vacía, para que un receptor Prometheus no añada sufijos y reglas y dashboard valgan para ambos caminos.
7. **Lotes (§5).** Si un hecho suelta más de 512 spans, la pasada se trocea en envíos de 512 y el cursor sólo avanza cuando todos salen; un reintento puede repetir un trozo ya aceptado, con los mismos ids.
8. **Estado del exportador (§6).** `failing` sólo con fallos reintentables (5xx, 429, red, timeout); un 4xx descarta el lote con un aviso en el log pero el colector responde, así que no cuenta como caída. El `lag` es el número de eventos del log sin exportar.
9. **Recurso (§4).** `OTEL_RESOURCE_ATTRIBUTES` se respeta salvo claves `host.*`, `os.*`, `process.*`, `user.*`, `enduser.*`, `device.*`, `container.*`, claves no válidas y valores con separadores de ruta; `service.name`, `service.version` y `pi_runtime.project` no se pueden pisar.
10. **`doctor` (§6).** Sección nueva `[telemetry]`; nunca muestra el endpoint (sólo `localhost` o `https`) ni valores de cabeceras (sólo nombres). El check `projections` de E1 cubre también las dos proyecciones nuevas.
11. **`host.log` (§7).** Pasa a ser del `JsonLineLogger`; stdout/stderr del proceso van a `host.stderr.log`, para que una rotación no deje el descriptor del proceso escribiendo en `host.log.1` y un host que muere antes de tener log siga dejando rastro. Cualquier ruta o URL dentro de un mensaje se sustituye por `<path>`.
12. **Estados de span no fijados por la spec.** Un turno con `outcome=error` sale `ERROR`; un `mcp_server` sale `UNSET` con `pi_runtime.exit_code`.

## Autorrevisión

- **Cobertura de la spec:** cada sección tiene tarea (tabla de arriba); lo de §11 queda fuera a propósito.
- **Marcadores:** ningún TBD, TODO ni "igual que la tarea N"; todos los pasos de código llevan el código completo o la edición exacta.
- **Consistencia de tipos entre tareas:** comprobada aplicando el plan entero sobre una copia del worktree (ficheros completos, añadidos al final de los tests y ediciones puntuales tal como están escritas): `npm test` da 438 tests en verde, gates de arquitectura incluidos, con cobertura global de 99,5 % de líneas, 96,4 % de ramas y 96,8 % de funciones. Los scripts de aceptación (`otlp-receiver.ts`, `otlp-inspect.ts`) se probaron con un POST real.
- **Tests existentes que cambian:** `EventsCli.test.ts` (dependencias nuevas y texto de uso, Task 10). El resto de tests de E1 sólo reciben casos nuevos al final o una aserción más (`StatePaths.test.ts`, `diagnosis.test.ts`).

