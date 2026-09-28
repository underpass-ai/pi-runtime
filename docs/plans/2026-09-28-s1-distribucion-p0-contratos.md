# S1 Distribución Underpass-Pi + P0 Contratos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `pi` arranque en cualquier proyecto con el paquete `underpass-pi` cargado. Ese paquete levanta perezosamente un host por proyecto que habla con `kmp-mcp` y `made-mcp` fijados y verificados, registra sus tools por fase y ofrece `underpass setup|doctor|update`. Además, fija con pruebas de contrato cómo se comportan de verdad ambos servidores.

**Architecture:** Hexagonal estricta con DDD. `domain` contiene value objects, entidades y servicios de dominio, sin I/O ni dependencias externas. `application` contiene puertos (interfaces), DTOs, mappers y casos de uso, y sólo depende de `domain`. `adapters` contiene los inbound (Pi, CLI, servidor IPC) y los outbound (MCP stdio, GitHub, OSV, sistema de ficheros, procesos, git, cliente IPC). `composition` cablea. Un archivo, una clase (o una interfaz, o un alias de tipo). Ningún primitivo cruza una frontera de dominio: los conceptos son value objects. Hay un test de arquitectura que hace cumplir las dependencias entre capas y el uno-por-fichero, y la cobertura mínima del 80 % la impone Node.

**Tech Stack:** Node ≥ 22.19 (máquina: 22.23.2) con type stripping nativo, `node:test` con cobertura nativa, `node:net`, `node:child_process`, `node:crypto`; Pi `@earendil-works/pi-coding-agent@0.87.1`; `kmp-mcp` v0.24.0; `made-mcp` v0.8.0.

**Spec:** `docs/specs/2026-09-28-underpass-pi-runtime-design.md` (§1, §2 S1, §3, §8, §12 P0, §14).

## Global Constraints

- **Hexagonal:**
  - `src/domain/**` no importa nada fuera de `src/domain/**`, ni `node:*`, salvo `node:crypto` en los VOs que calculan huellas.
  - `src/application/**` sólo importa `src/domain/**` y `src/application/**`.
  - `src/adapters/**` importa `domain`, `application` y `node:*`, pero nunca `composition`.
  - `src/composition/**` puede importarlo todo.
  - Lo verifica `tests/architecture/layers.test.ts`.
- **Un archivo, una clase:** cada fichero de `src/` declara como mucho una `class`. Un puerto es un fichero con una única `export interface`. Una unión de tipos es un fichero con un único `export type`. Lo verifica `tests/architecture/one-type-per-file.test.ts`. Los entry points (`bin/*.ts`, `src/adapters/inbound/pi/entry/*.ts`) no declaran clases: sólo componen.
- **Sin primitive obsession:**
  - Los constructores y métodos públicos de `domain` y `application` reciben y devuelven value objects, entidades o DTOs, nunca `string` o `number` desnudos para un concepto de dominio.
  - Los DTOs (`application/dto`) sí son primitivos: son la frontera con el exterior, y los mappers los convierten.
  - Todo VO valida en su factoría estática (`of`, `parse` o `generate`), tiene constructor privado y `equals`.
- **DTOs sólo en las fronteras:** los adapters hablan DTO con el exterior y los mappers hacen DTO → dominio en la entrada y dominio → DTO en la salida.
- **Cobertura:** el script de test impone `--test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80` sobre `src/**`, excluidos únicamente `src/adapters/inbound/pi/entry/**` (entry points de una línea). Si baja del 80 %, el comando termina con exit 1.
- **Sin dependencias npm en el código propio.** `package.json` no tiene `dependencies` ni `devDependencies`. `@earendil-works/pi-coding-agent` y `typebox` van en `peerDependencies: "*"`: se importan como `import type`, salvo `typebox`, que Pi sirve como módulo virtual y sólo se importa en `src/adapters/inbound/pi/entry/**`.
- **TypeScript borrable:** nada de `enum`, `namespace`, parameter properties ni decoradores. Los imports relativos llevan `.ts`. No hay type-checker (decisión consciente).
- **Pi entra por una excepción acotada:** `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.1` bajo un prefijo propio, con el `npm-shrinkwrap.json` publicado, integridad del tarball `sha512-m8ArJUtVcQMSe1lLE/Ei7vX/JV7O39sWmWBsXV2NOU70F0qCp8GubA24pT3LnwTmM6LL2xV80/h6sQg85n69ew==` y auditoría OSV de todo el árbol antes de exponer `pi`. Se fija 0.87.1 publicado, no HEAD: en 0.87.1, `steer()`/`followUp()` devuelven `Promise<void>`.
- **Binarios fijados y verificados por sha256:**
  - `kmp-mcp` v0.24.0: aarch64-linux `1eb1e9ee366c8fb1d20172c67786a70ea53108c415f8db8c9437243329f971af`, x86_64-linux `3ae44e6b37b5c247a055dad416e1ccbc3cdbdf3ea2e5a0cc0caeaec809e69e1d`, aarch64-darwin `77ef7ee76761f41c1566b26c0ec192b23226f800f9472002adcb44421103079e`.
  - `made-mcp` v0.8.0: aarch64-linux `a3f1cf2223fedafb5584ad56e4ca0870179c6abce3b315ac988b13d5d91dbafa`, x86_64-linux `c2bba7b3e75543b1cbea5a5bdde27acde5eb9182ed1aeabcfdccaf048bed8db2`, aarch64-darwin `f497abd8bf2ea303cc5aabdf857131d172d40035010cbca09f982df40f293a44`.
- **Protocolo MCP medido:** ambos servidores responden `protocolVersion: "2024-11-05"` fijo, no tienen `ping`, descartan `notifications/cancelled` y **procesan en secuencia cada conexión stdio**. Las negativas de negocio llegan con `isError: true`:
  - KMP: `structuredContent.error{code,message}`;
  - MADE: `structuredContent{code,message,retryable}`.
- **Store de MADE compartido con el plugin de MADE:**
  - Ruta del store: `${MADE_MCP_STORE_PATH:-${XDG_STATE_HOME:-~/.local/state}/underpass-made/ceremonies.sqlite3}`.
  - Configuración privada: `${MADE_SETUP_CONFIG_ROOT:-${XDG_CONFIG_HOME:-~/.config}/underpass-made/embedded}/<sha256(ruta)[0:16]>.env`.
  - Requisitos de ese fichero: propietario el usuario, modo 600 o 400, sin symlink, exactamente `MADE_AUTH_POLICY_ID`, `MADE_AUTH_TRUSTED_HOST_ID`, `MADE_CEREMONY_STORE_ID` y `MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY` (64 hex).
  - **Nunca** se rota una clave existente. La clave no se imprime, no va en argumentos, no aparece en recibos y su `toString()` devuelve `[redacted]`.
- **Estado del host fuera del proyecto:** `${XDG_STATE_HOME:-~/.local/state}/underpass-pi/`.
- **Las factorías de extensión no abren procesos, sockets ni timers;** todo arranca en `session_start`.
- **Pruebas de contrato contra binarios reales** sólo con `UNDERPASS_KMP_MCP_BIN` y `UNDERPASS_MADE_MCP_BIN`; si no, se marcan como skip, nunca como pass. Van fuera del umbral de cobertura (script `test:contract`).
- **Commits** en español con prefijo convencional, en ramas `feat/s1-*`. El cambio de KMP va en su repo, con su rama y su PR.

---

## Mapa de capas

Se escribe antes que el código y se mantiene: cada tarea añade sus ficheros en su sitio.

```text
src/
  domain/
    shared/        ValueObject, DomainError
    distribution/  Target, SemVer, Sha256Digest, Sha512Integrity, RepositorySlug, BinaryName,
                   BinaryPin, NpmPackageName, PiPin, PinSet, PackageCoordinate, AdvisoryId,
                   VulnerabilityFinding, AuditReport
    mcp/           ServerName, ToolName, ToolDescription, JsonSchema, ToolDescriptor, ProtocolVersion,
                   ServerIdentity, CatalogFingerprint, ToolCatalog, RefusalCode, ToolSuccess, ToolRefusal,
                   ToolOutcome (type)
    contracts/     ProfileId, ToolProfile, ProfileCheck, ToolProfiles
    made/          StorePath, PolicyId, TrustedHostId, CeremonyStoreId, CursorHmacKey, MadeConfiguration,
                   CapabilityGroupId, DeclaredLimitId, MadeCapabilities
    project/       ProjectRoot, ProjectId, Project
    session/       Phase, PhaseToolSelection
    diagnosis/     CheckSection, CheckStatus, CheckName, CheckDetail, Check, DiagnosisReport, FingerprintDrift
  application/
    ports/         PinSetSource, ReleaseDownloader, FileDigester, BinaryInstallation, VulnerabilityDatabase,
                   McpConnection, McpConnector, MadeConfigurationRepository, EntropySource,
                   AuthorizationBootstrapper, KmpLifecycle, PiPackageManager, PiRuntimeInspector,
                   ProjectLocator, OwnerLock, OwnerLockAcquisition (type), HostGateway, HostLauncher,
                   FingerprintRepository, ServerCommandFactory
    dto/           PinSetDto, ShrinkwrapDto, McpToolDto, McpToolResultDto, MadeCapabilitiesDto,
                   HostRequestDto, HostResponseDto, CatalogDto, ToolCallResultDto, CheckDto, ServerCommandDto
    mappers/       PinSetMapper, ShrinkwrapMapper, McpToolMapper, ToolOutcomeMapper, MadeCapabilitiesMapper,
                   CatalogMapper, HostResponseMapper, CheckMapper
    services/      ServerPool
    use-cases/     InstallPinnedBinaries, AuditDependencyTree, EnsureMadeConfiguration,
                   BootstrapMadeAuthorization, ReadServerCatalog, CallServerTool, VerifyServerProfiles,
                   DiscoverMadeCapabilities, ServeHostRequest, ConnectToProjectHost, SelectPhaseTools,
                   SetupInstallation, DiagnoseInstallation
  adapters/
    outbound/
      mcp/         McpRpcError, McpTransportError, StdioMcpConnection, StdioMcpConnector
      github/      GithubReleaseDownloader
      fs/          JsonPinSetSource, NodeFileDigester, FsBinaryInstallation, FsMadeConfigurationRepository,
                   FsFingerprintRepository, FsOwnerLock
      osv/         OsvVulnerabilityDatabase
      crypto/      NodeEntropySource
      process/     KmpServerCommandFactory, MadeServerCommandFactory, MadeCliAuthorizationBootstrapper,
                   KmpCliLifecycle, PiCliPackageManager, PiCliRuntimeInspector, DetachedHostLauncher
      git/         GitProjectLocator
      ipc/         UnixSocketHostGateway, HostCallError
    inbound/
      ipc/         UnixSocketHostServer
      cli/         CheckRenderer, UnderpassCli
      pi/          PiToolFactory, HostExtension, ServerToolsExtension, entry/{host,kmp,made}.ts
  composition/     StatePaths, HostComposition, CliComposition, ExtensionComposition
bin/               underpass.ts, underpass-host.ts, osv-audit.ts
```

Dependencias permitidas: `domain` ← `application` ← `adapters` ← `composition` ← `bin` / `entry`.

---

### Task 0: Esqueleto, gates de arquitectura y cobertura

**Files:**
- Create: `package.json`, `scripts/test.sh`, `tests/architecture/layers.test.ts`, `tests/architecture/one-type-per-file.test.ts`, `tests/architecture/source-files.ts`, `src/domain/shared/ValueObject.ts`, `src/domain/shared/DomainError.ts`
- Test: `tests/unit/domain/shared/ValueObject.test.ts`

**Interfaces:**
- Produces:
  - `abstract class ValueObject<T>` con `protected constructor(value: T)`, `get value(): T`, `equals(other: ValueObject<T>): boolean` y `toString(): string`
  - `class DomainError extends Error` con `static because(message: string): DomainError`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "underpass-pi",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "bin": { "underpass": "./bin/underpass.ts" },
  "keywords": ["pi-package"],
  "pi": {
    "extensions": [
      "./src/adapters/inbound/pi/entry/host.ts",
      "./src/adapters/inbound/pi/entry/kmp.ts",
      "./src/adapters/inbound/pi/entry/made.ts"
    ]
  },
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*", "typebox": "*" },
  "scripts": {
    "test": "bash scripts/test.sh",
    "test:contract": "node --test --test-reporter=spec \"tests/contract/*.test.ts\""
  }
}
```

- [ ] **Step 2: `scripts/test.sh`, el gate de cobertura**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --test --test-reporter=spec \
  --experimental-test-coverage \
  --test-coverage-include='src/**/*.ts' \
  --test-coverage-exclude='src/adapters/inbound/pi/entry/**' \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  "tests/unit/**/*.test.ts" "tests/architecture/*.test.ts"
```

- [ ] **Step 3: Utilidad de los tests de arquitectura** `tests/architecture/source-files.ts`

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = new URL("../../", import.meta.url).pathname;

export function sourceFiles(dir = join(ROOT, "src")): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [{ path: relative(ROOT, full), text: readFileSync(full, "utf8") }] : [];
  });
}

export function importsOf(text: string): string[] {
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}
```

- [ ] **Step 4: Tests de arquitectura**

`tests/architecture/layers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, normalize } from "node:path";
import { importsOf, sourceFiles } from "./source-files.ts";

const layerOf = (path: string) => path.split("/")[1]; // src/<layer>/...
const ALLOWED: Record<string, string[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  adapters: ["domain", "application", "adapters"],
  composition: ["domain", "application", "adapters", "composition"],
};
const NODE_ALLOWED_IN_DOMAIN = new Set(["node:crypto"]);

test("cada capa sólo importa las capas permitidas", () => {
  const violations: string[] = [];
  for (const file of sourceFiles()) {
    const layer = layerOf(file.path);
    for (const spec of importsOf(file.text)) {
      if (spec.startsWith("node:")) {
        if ((layer === "domain" && !NODE_ALLOWED_IN_DOMAIN.has(spec)) || layer === "application") violations.push(`${file.path} -> ${spec}`);
        continue;
      }
      if (!spec.startsWith(".")) {
        if (!file.path.startsWith("src/adapters/inbound/pi/")) violations.push(`${file.path} -> ${spec} (external package)`);
        continue;
      }
      const target = normalize(join(dirname(file.path), spec));
      const targetLayer = layerOf(target);
      if (!ALLOWED[layer]?.includes(targetLayer)) violations.push(`${file.path} -> ${target}`);
    }
  }
  assert.deepEqual(violations, []);
});
```

`tests/architecture/one-type-per-file.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceFiles } from "./source-files.ts";

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

test("un archivo, una clase / interfaz / tipo", () => {
  const offenders = sourceFiles().filter(({ path, text }) => {
    if (path.startsWith("src/adapters/inbound/pi/entry/")) return count(text, /^\s*(export\s+)?(abstract\s+)?class\s/gm) > 0;
    const declarations = count(text, /^\s*(export\s+)?(abstract\s+)?class\s/gm)
      + count(text, /^\s*export\s+interface\s/gm)
      + count(text, /^\s*export\s+type\s+\w+\s*=/gm);
    return declarations !== 1;
  }).map((f) => f.path);
  assert.deepEqual(offenders, []);
});

test("los VOs de dominio tienen constructor privado", () => {
  const offenders = sourceFiles()
    .filter(({ path, text }) => path.startsWith("src/domain/") && /extends ValueObject</.test(text) && !/private constructor/.test(text))
    .map((f) => f.path);
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 5: Test del VO base** `tests/unit/domain/shared/ValueObject.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ValueObject } from "../../../../src/domain/shared/ValueObject.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

class Probe extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(v: string): Probe { return new Probe(v); }
}

test("igualdad por valor y toString", () => {
  assert.ok(Probe.of("a").equals(Probe.of("a")));
  assert.ok(!Probe.of("a").equals(Probe.of("b")));
  assert.equal(String(Probe.of("a")), "a");
});

test("DomainError.because", () => {
  const e = DomainError.because("bad");
  assert.ok(e instanceof DomainError);
  assert.equal(e.message, "bad");
});
```

- [ ] **Step 6: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, `Cannot find module .../ValueObject.ts`

- [ ] **Step 7: Implementar**

`src/domain/shared/ValueObject.ts`:

```ts
export abstract class ValueObject<T> {
  readonly #value: T;
  protected constructor(value: T) { this.#value = value; }
  get value(): T { return this.#value; }
  equals(other: ValueObject<T>): boolean { return other.constructor === this.constructor && other.value === this.value; }
  toString(): string { return String(this.#value); }
}
```

`src/domain/shared/DomainError.ts`:

```ts
export class DomainError extends Error {
  private constructor(message: string) { super(message); this.name = "DomainError"; }
  static because(message: string): DomainError { return new DomainError(message); }
}
```

- [ ] **Step 8: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS (5 tests) y resumen de cobertura ≥ 80 %.

- [ ] **Step 9: Commit**

```bash
git add package.json scripts/test.sh tests/architecture tests/unit/domain/shared src/domain/shared
git commit -m "chore: esqueleto hexagonal con gates de capas, uno-por-fichero y cobertura 80 %"
```

---

### Task 1: Dominio de distribución y fijaciones

**Files:**
- Create:
  - dominio (uno por fichero): `src/domain/distribution/{Target,SemVer,Sha256Digest,Sha512Integrity,RepositorySlug,BinaryName,NpmPackageName,BinaryPin,PiPin,PinSet}.ts`
  - aplicación: `src/application/dto/PinSetDto.ts`, `src/application/mappers/PinSetMapper.ts`, `src/application/ports/PinSetSource.ts`
  - adaptador: `src/adapters/outbound/fs/JsonPinSetSource.ts`
  - datos: `pins.json`
- Test: `tests/unit/domain/distribution/*.test.ts`, `tests/unit/application/mappers/PinSetMapper.test.ts`, `tests/unit/adapters/outbound/fs/JsonPinSetSource.test.ts`

**Interfaces:**
- Produces:
  - `Target.of(raw: string): Target`, `Target.detect(platform: string, arch: string): Target`, `Target.all(): Target[]`
  - `SemVer.of(raw)`; `Sha256Digest.of(raw)`; `Sha512Integrity.of(raw)`; `RepositorySlug.of("owner/repo")`; `BinaryName.of("kmp-mcp"|"made-mcp")`, `BinaryName.KMP`, `BinaryName.MADE`; `NpmPackageName.of(raw)`
  - `BinaryPin.of({ name: BinaryName; version: SemVer; repository: RepositorySlug; digests: Map<string, Sha256Digest> })`, con:
    - `digestFor(target: Target): Sha256Digest`
    - `assetName(target: Target): string` (nombre de fichero de release; es un detalle de frontera, se devuelve como `string`)
    - `releaseUrl(target: Target): URL`
    - `installedFileName(): string`
  - `PiPin.of({ packageName: NpmPackageName; version: SemVer; integrity: Sha512Integrity })`
  - `PinSet.of(pi: PiPin, binaries: BinaryPin[])`, `pinFor(name: BinaryName): BinaryPin`
  - `PinSetDto`:

    ```ts
    type PinSetDto = {
      pi: { package: string; version: string; integrity: string };
      binaries: { name: string; version: string; repo: string; sha256: Record<string, string> }[];
    }
    ```
  - `PinSetMapper.toDomain(dto: PinSetDto): PinSet`
  - `interface PinSetSource { load(): PinSet }`
  - `JsonPinSetSource` con `constructor(file: string)`

- [ ] **Step 1: Crear `pins.json`** con los valores exactos de Global Constraints

```json
{
  "pi": { "package": "@earendil-works/pi-coding-agent", "version": "0.87.1", "integrity": "sha512-m8ArJUtVcQMSe1lLE/Ei7vX/JV7O39sWmWBsXV2NOU70F0qCp8GubA24pT3LnwTmM6LL2xV80/h6sQg85n69ew==" },
  "binaries": [
    { "name": "kmp-mcp", "version": "0.24.0", "repo": "underpass-ai/kmp", "sha256": {
      "aarch64-unknown-linux-gnu": "1eb1e9ee366c8fb1d20172c67786a70ea53108c415f8db8c9437243329f971af",
      "x86_64-unknown-linux-gnu": "3ae44e6b37b5c247a055dad416e1ccbc3cdbdf3ea2e5a0cc0caeaec809e69e1d",
      "aarch64-apple-darwin": "77ef7ee76761f41c1566b26c0ec192b23226f800f9472002adcb44421103079e" } },
    { "name": "made-mcp", "version": "0.8.0", "repo": "underpass-ai/made", "sha256": {
      "aarch64-unknown-linux-gnu": "a3f1cf2223fedafb5584ad56e4ca0870179c6abce3b315ac988b13d5d91dbafa",
      "x86_64-unknown-linux-gnu": "c2bba7b3e75543b1cbea5a5bdde27acde5eb9182ed1aeabcfdccaf048bed8db2",
      "aarch64-apple-darwin": "f497abd8bf2ea303cc5aabdf857131d172d40035010cbca09f982df40f293a44" } }
  ]
}
```

- [ ] **Step 2: Tests que fallan** `tests/unit/domain/distribution/distribution.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Target } from "../../../../src/domain/distribution/Target.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { Sha256Digest } from "../../../../src/domain/distribution/Sha256Digest.ts";
import { Sha512Integrity } from "../../../../src/domain/distribution/Sha512Integrity.ts";
import { RepositorySlug } from "../../../../src/domain/distribution/RepositorySlug.ts";
import { BinaryName } from "../../../../src/domain/distribution/BinaryName.ts";
import { NpmPackageName } from "../../../../src/domain/distribution/NpmPackageName.ts";
import { BinaryPin } from "../../../../src/domain/distribution/BinaryPin.ts";
import { PiPin } from "../../../../src/domain/distribution/PiPin.ts";
import { PinSet } from "../../../../src/domain/distribution/PinSet.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const hex = "a".repeat(64);
const digests = () => new Map(Target.all().map((t) => [t.value, Sha256Digest.of(hex)]));
const kmpPin = () => BinaryPin.of({ name: BinaryName.KMP, version: SemVer.of("0.24.0"), repository: RepositorySlug.of("underpass-ai/kmp"), digests: digests() });

test("Target: detecta y valida", () => {
  assert.equal(Target.detect("linux", "arm64").value, "aarch64-unknown-linux-gnu");
  assert.equal(Target.detect("linux", "x64").value, "x86_64-unknown-linux-gnu");
  assert.equal(Target.detect("darwin", "arm64").value, "aarch64-apple-darwin");
  assert.throws(() => Target.detect("win32", "x64"), DomainError);
  assert.throws(() => Target.of("mips"), DomainError);
});

test("VOs rechazan formatos inválidos", () => {
  assert.throws(() => SemVer.of("1.0"), DomainError);
  assert.throws(() => Sha256Digest.of("xyz"), DomainError);
  assert.throws(() => Sha512Integrity.of("sha256-abc"), DomainError);
  assert.throws(() => RepositorySlug.of("nope"), DomainError);
  assert.throws(() => BinaryName.of("other-mcp"), DomainError);
  assert.throws(() => NpmPackageName.of("Bad Name"), DomainError);
  assert.equal(Sha256Digest.of(hex.toUpperCase()).value, hex);
});

test("BinaryPin: asset, url, digest y fichero instalado", () => {
  const pin = kmpPin();
  const t = Target.of("aarch64-unknown-linux-gnu");
  assert.equal(pin.assetName(t), "kmp-mcp-v0.24.0-aarch64-unknown-linux-gnu");
  assert.equal(pin.releaseUrl(t).href, "https://github.com/underpass-ai/kmp/releases/download/v0.24.0/kmp-mcp-v0.24.0-aarch64-unknown-linux-gnu");
  assert.ok(pin.digestFor(t).equals(Sha256Digest.of(hex)));
  assert.equal(pin.installedFileName(), "kmp-mcp-0.24.0");
});

test("BinaryPin exige digest para todos los targets", () => {
  assert.throws(() => BinaryPin.of({ name: BinaryName.KMP, version: SemVer.of("1.0.0"), repository: RepositorySlug.of("a/b"), digests: new Map() }), /digest/);
});

test("PinSet: busca por nombre y rechaza duplicados o ausencias", () => {
  const pi = PiPin.of({ packageName: NpmPackageName.of("@earendil-works/pi-coding-agent"), version: SemVer.of("0.87.1"), integrity: Sha512Integrity.of("sha512-abc=") });
  const set = PinSet.of(pi, [kmpPin()]);
  assert.equal(set.pinFor(BinaryName.KMP).version.value, "0.24.0");
  assert.throws(() => set.pinFor(BinaryName.MADE), DomainError);
  assert.throws(() => PinSet.of(pi, [kmpPin(), kmpPin()]), /duplicate/);
  assert.equal(set.pi.version.value, "0.87.1");
});
```

`tests/unit/application/mappers/PinSetMapper.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PinSetMapper } from "../../../../src/application/mappers/PinSetMapper.ts";
import { BinaryName } from "../../../../src/domain/distribution/BinaryName.ts";
import { JsonPinSetSource } from "../../../../src/adapters/outbound/fs/JsonPinSetSource.ts";

test("el pins.json del repo produce un PinSet válido", () => {
  const set = new JsonPinSetSource(new URL("../../../../pins.json", import.meta.url).pathname).load();
  assert.equal(set.pinFor(BinaryName.MADE).version.value, "0.8.0");
  assert.equal(set.pi.integrity.value.startsWith("sha512-"), true);
});

test("el mapper propaga el error de dominio de un DTO corrupto", () => {
  assert.throws(() => new PinSetMapper().toDomain({ pi: { package: "x", version: "1", integrity: "y" }, binaries: [] }));
});
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 4: Implementar el dominio**

`src/domain/distribution/Target.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const SUPPORTED = ["aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "aarch64-apple-darwin"] as const;
const DETECT: Record<string, string> = { "linux/arm64": SUPPORTED[0], "linux/x64": SUPPORTED[1], "darwin/arm64": SUPPORTED[2] };

export class Target extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): Target {
    if (!(SUPPORTED as readonly string[]).includes(raw)) throw DomainError.because(`unsupported target ${raw}`);
    return new Target(raw);
  }
  static detect(platform: string, arch: string): Target {
    const t = DETECT[`${platform}/${arch}`];
    if (!t) throw DomainError.because(`unsupported platform ${platform}/${arch}`);
    return new Target(t);
  }
  static all(): Target[] { return SUPPORTED.map((t) => new Target(t)); }
}
```

`src/domain/distribution/SemVer.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class SemVer extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): SemVer {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(raw)) throw DomainError.because(`invalid semver ${raw}`);
    return new SemVer(raw);
  }
}
```

`src/domain/distribution/Sha256Digest.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class Sha256Digest extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): Sha256Digest {
    const v = raw.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(v)) throw DomainError.because("sha256 digest must be 64 hex characters");
    return new Sha256Digest(v);
  }
}
```

`src/domain/distribution/Sha512Integrity.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class Sha512Integrity extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): Sha512Integrity {
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(raw)) throw DomainError.because("integrity must be an SRI sha512 string");
    return new Sha512Integrity(raw);
  }
}
```

`src/domain/distribution/RepositorySlug.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class RepositorySlug extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): RepositorySlug {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) throw DomainError.because(`invalid repository ${raw}`);
    return new RepositorySlug(raw);
  }
}
```

`src/domain/distribution/BinaryName.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class BinaryName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly KMP = new BinaryName("kmp-mcp");
  static readonly MADE = new BinaryName("made-mcp");
  static of(raw: string): BinaryName {
    if (raw === BinaryName.KMP.value) return BinaryName.KMP;
    if (raw === BinaryName.MADE.value) return BinaryName.MADE;
    throw DomainError.because(`unknown binary ${raw}`);
  }
}
```

`src/domain/distribution/NpmPackageName.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class NpmPackageName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): NpmPackageName {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(raw)) throw DomainError.because(`invalid npm package name ${raw}`);
    return new NpmPackageName(raw);
  }
}
```

`src/domain/distribution/BinaryPin.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { BinaryName } from "./BinaryName.ts";
import type { RepositorySlug } from "./RepositorySlug.ts";
import type { SemVer } from "./SemVer.ts";
import type { Sha256Digest } from "./Sha256Digest.ts";
import { Target } from "./Target.ts";

type Props = { name: BinaryName; version: SemVer; repository: RepositorySlug; digests: Map<string, Sha256Digest> };

export class BinaryPin {
  readonly name: BinaryName;
  readonly version: SemVer;
  readonly repository: RepositorySlug;
  readonly #digests: Map<string, Sha256Digest>;

  private constructor(p: Props) { this.name = p.name; this.version = p.version; this.repository = p.repository; this.#digests = p.digests; }

  static of(p: Props): BinaryPin {
    for (const t of Target.all()) if (!p.digests.has(t.value)) throw DomainError.because(`${p.name} has no digest for ${t}`);
    return new BinaryPin(p);
  }

  digestFor(target: Target): Sha256Digest { return this.#digests.get(target.value)!; }
  assetName(target: Target): string { return `${this.name}-v${this.version}-${target}`; }
  releaseUrl(target: Target): URL { return new URL(`https://github.com/${this.repository}/releases/download/v${this.version}/${this.assetName(target)}`); }
  installedFileName(): string { return `${this.name}-${this.version}`; }
}
```

`src/domain/distribution/PiPin.ts`:

```ts
import type { NpmPackageName } from "./NpmPackageName.ts";
import type { SemVer } from "./SemVer.ts";
import type { Sha512Integrity } from "./Sha512Integrity.ts";

type Props = { packageName: NpmPackageName; version: SemVer; integrity: Sha512Integrity };

export class PiPin {
  readonly packageName: NpmPackageName;
  readonly version: SemVer;
  readonly integrity: Sha512Integrity;
  private constructor(p: Props) { this.packageName = p.packageName; this.version = p.version; this.integrity = p.integrity; }
  static of(p: Props): PiPin { return new PiPin(p); }
}
```

`src/domain/distribution/PinSet.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { BinaryName } from "./BinaryName.ts";
import type { BinaryPin } from "./BinaryPin.ts";
import type { PiPin } from "./PiPin.ts";

export class PinSet {
  readonly pi: PiPin;
  readonly #binaries: BinaryPin[];
  private constructor(pi: PiPin, binaries: BinaryPin[]) { this.pi = pi; this.#binaries = binaries; }

  static of(pi: PiPin, binaries: BinaryPin[]): PinSet {
    const names = binaries.map((b) => b.name.value);
    if (new Set(names).size !== names.length) throw DomainError.because("duplicate binary pin");
    return new PinSet(pi, binaries);
  }

  pinFor(name: BinaryName): BinaryPin {
    const pin = this.#binaries.find((b) => b.name.equals(name));
    if (!pin) throw DomainError.because(`no pin for ${name}`);
    return pin;
  }

  binaries(): BinaryPin[] { return [...this.#binaries]; }
}
```

- [ ] **Step 5: Implementar aplicación y adaptador**

`src/application/dto/PinSetDto.ts`:

```ts
export type PinSetDto = {
  pi: { package: string; version: string; integrity: string };
  binaries: { name: string; version: string; repo: string; sha256: Record<string, string> }[];
};
```

`src/application/ports/PinSetSource.ts`:

```ts
import type { PinSet } from "../../domain/distribution/PinSet.ts";

export interface PinSetSource { load(): PinSet; }
```

`src/application/mappers/PinSetMapper.ts`:

```ts
import { BinaryName } from "../../domain/distribution/BinaryName.ts";
import { BinaryPin } from "../../domain/distribution/BinaryPin.ts";
import { NpmPackageName } from "../../domain/distribution/NpmPackageName.ts";
import { PiPin } from "../../domain/distribution/PiPin.ts";
import { PinSet } from "../../domain/distribution/PinSet.ts";
import { RepositorySlug } from "../../domain/distribution/RepositorySlug.ts";
import { SemVer } from "../../domain/distribution/SemVer.ts";
import { Sha256Digest } from "../../domain/distribution/Sha256Digest.ts";
import { Sha512Integrity } from "../../domain/distribution/Sha512Integrity.ts";
import { Target } from "../../domain/distribution/Target.ts";
import type { PinSetDto } from "../dto/PinSetDto.ts";

export class PinSetMapper {
  toDomain(dto: PinSetDto): PinSet {
    const pi = PiPin.of({ packageName: NpmPackageName.of(dto.pi.package), version: SemVer.of(dto.pi.version), integrity: Sha512Integrity.of(dto.pi.integrity) });
    const binaries = dto.binaries.map((b) => BinaryPin.of({
      name: BinaryName.of(b.name),
      version: SemVer.of(b.version),
      repository: RepositorySlug.of(b.repo),
      digests: new Map(Object.entries(b.sha256).map(([t, d]) => [Target.of(t).value, Sha256Digest.of(d)])),
    }));
    return PinSet.of(pi, binaries);
  }
}
```

`src/adapters/outbound/fs/JsonPinSetSource.ts`:

```ts
import { readFileSync } from "node:fs";
import type { PinSetSource } from "../../../application/ports/PinSetSource.ts";
import { PinSetMapper } from "../../../application/mappers/PinSetMapper.ts";
import type { PinSet } from "../../../domain/distribution/PinSet.ts";

export class JsonPinSetSource implements PinSetSource {
  readonly #file: string;
  constructor(file: string) { this.#file = file; }
  load(): PinSet { return new PinSetMapper().toDomain(JSON.parse(readFileSync(this.#file, "utf8"))); }
}
```

- [ ] **Step 6: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %, arquitectura en verde.

- [ ] **Step 7: Commit**

```bash
git add pins.json src/domain/distribution src/application src/adapters tests/unit
git commit -m "feat(dominio): fijaciones de distribución como value objects y mapper desde pins.json"
```

---

### Task 2: Caso de uso `InstallPinnedBinaries`

**Files:**
- Create:
  - puertos: `src/application/ports/{ReleaseDownloader,FileDigester,BinaryInstallation}.ts`
  - caso de uso: `src/application/use-cases/InstallPinnedBinaries.ts`
  - adaptadores: `src/adapters/outbound/github/GithubReleaseDownloader.ts`, `src/adapters/outbound/fs/{NodeFileDigester,FsBinaryInstallation}.ts`
- Test: `tests/unit/application/use-cases/InstallPinnedBinaries.test.ts`, `tests/unit/adapters/outbound/fs/FsBinaryInstallation.test.ts`

**Interfaces:**
- Consumes: `PinSet`, `BinaryPin`, `Target`, `Sha256Digest`, `BinaryName` (Task 1)
- Produces:
  - `interface ReleaseDownloader { download(url: URL, to: string): Promise<void> }`
  - `interface FileDigester { sha256(path: string): Promise<Sha256Digest> }`
  - `interface BinaryInstallation`:
    - `pathOf(pin: BinaryPin): string`
    - `stagingPathOf(pin: BinaryPin): string`
    - `commit(pin: BinaryPin): void` (chmod 755 + rename atómico)
    - `discard(pin: BinaryPin): void`
    - `exists(pin: BinaryPin): boolean`
  - `InstallPinnedBinaries`:
    - `constructor(pins: PinSet, target: Target, downloader: ReleaseDownloader, digester: FileDigester, installation: BinaryInstallation)`
    - `execute(): Promise<{ name: BinaryName; path: string; action: "verified" | "installed" }[]>`
    - lanza `DomainError` con `sha256 mismatch` y descarta lo descargado
  - `FsBinaryInstallation` con `constructor(dir: string)`

- [ ] **Step 1: Tests que fallan**

`tests/unit/application/use-cases/InstallPinnedBinaries.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InstallPinnedBinaries } from "../../../../src/application/use-cases/InstallPinnedBinaries.ts";
import { PinSetMapper } from "../../../../src/application/mappers/PinSetMapper.ts";
import { Target } from "../../../../src/domain/distribution/Target.ts";
import { Sha256Digest } from "../../../../src/domain/distribution/Sha256Digest.ts";
import type { BinaryPin } from "../../../../src/domain/distribution/BinaryPin.ts";

const good = "b".repeat(64);
const pins = new PinSetMapper().toDomain({
  pi: { package: "p", version: "1.0.0", integrity: "sha512-x=" },
  binaries: ["kmp-mcp", "made-mcp"].map((name) => ({ name, version: "1.0.0", repo: "o/r",
    sha256: Object.fromEntries(Target.all().map((t) => [t.value, good])) })),
});
const target = Target.of("aarch64-unknown-linux-gnu");

class FakeInstallation {
  readonly present = new Set<string>(); readonly committed: string[] = []; readonly discarded: string[] = [];
  pathOf(p: BinaryPin) { return `/bin/${p.installedFileName()}`; }
  stagingPathOf(p: BinaryPin) { return `/bin/.${p.installedFileName()}.partial`; }
  exists(p: BinaryPin) { return this.present.has(p.installedFileName()); }
  commit(p: BinaryPin) { this.committed.push(p.installedFileName()); }
  discard(p: BinaryPin) { this.discarded.push(p.installedFileName()); }
}

test("verifica lo instalado y descarga sólo lo que falta", async () => {
  const inst = new FakeInstallation(); inst.present.add("kmp-mcp-1.0.0");
  const urls: string[] = [];
  const uc = new InstallPinnedBinaries(pins, target, { download: async (u) => { urls.push(u.href); } }, { sha256: async () => Sha256Digest.of(good) }, inst);
  const res = await uc.execute();
  assert.deepEqual(res.map((r) => [r.name.value, r.action]), [["kmp-mcp", "verified"], ["made-mcp", "installed"]]);
  assert.deepEqual(urls, ["https://github.com/o/r/releases/download/v1.0.0/made-mcp-v1.0.0-aarch64-unknown-linux-gnu"]);
  assert.deepEqual(inst.committed, ["made-mcp-1.0.0"]);
});

test("un digest distinto descarta la descarga y falla", async () => {
  const inst = new FakeInstallation();
  const uc = new InstallPinnedBinaries(pins, target, { download: async () => {} }, { sha256: async () => Sha256Digest.of("c".repeat(64)) }, inst);
  await assert.rejects(uc.execute(), /sha256 mismatch for kmp-mcp/);
  assert.deepEqual(inst.committed, []);
  assert.deepEqual(inst.discarded, ["kmp-mcp-1.0.0"]);
});

test("un binario instalado pero alterado se vuelve a descargar", async () => {
  const inst = new FakeInstallation(); inst.present.add("kmp-mcp-1.0.0"); inst.present.add("made-mcp-1.0.0");
  let calls = 0;
  const digester = { sha256: async (path: string) => Sha256Digest.of(path.endsWith(".partial") || calls++ > 0 ? good : "d".repeat(64)) };
  const uc = new InstallPinnedBinaries(pins, target, { download: async () => {} }, digester, inst);
  const res = await uc.execute();
  assert.equal(res[0].action, "installed");
});
```

`tests/unit/adapters/outbound/fs/FsBinaryInstallation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsBinaryInstallation } from "../../../../../src/adapters/outbound/fs/FsBinaryInstallation.ts";
import { NodeFileDigester } from "../../../../../src/adapters/outbound/fs/NodeFileDigester.ts";
import { PinSetMapper } from "../../../../../src/application/mappers/PinSetMapper.ts";
import { BinaryName } from "../../../../../src/domain/distribution/BinaryName.ts";
import { Target } from "../../../../../src/domain/distribution/Target.ts";

const pin = new PinSetMapper().toDomain({ pi: { package: "p", version: "1.0.0", integrity: "sha512-x=" },
  binaries: [{ name: "kmp-mcp", version: "1.0.0", repo: "o/r", sha256: Object.fromEntries(Target.all().map((t) => [t.value, "a".repeat(64)])) }] }).pinFor(BinaryName.KMP);

test("commit deja el binario ejecutable en su ruta final; discard limpia", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bin-"));
  const inst = new FsBinaryInstallation(dir);
  writeFileSync(inst.stagingPathOf(pin), "#!/bin/sh\n");
  assert.match((await new NodeFileDigester().sha256(inst.stagingPathOf(pin))).value, /^[0-9a-f]{64}$/);
  inst.commit(pin);
  assert.ok(inst.exists(pin));
  assert.ok(statSync(inst.pathOf(pin)).mode & 0o100);
  writeFileSync(inst.stagingPathOf(pin), "x");
  inst.discard(pin);
  assert.equal(existsSync(inst.stagingPathOf(pin)), false);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar**

`src/application/ports/ReleaseDownloader.ts`:

```ts
export interface ReleaseDownloader { download(url: URL, to: string): Promise<void>; }
```

`src/application/ports/FileDigester.ts`:

```ts
import type { Sha256Digest } from "../../domain/distribution/Sha256Digest.ts";

export interface FileDigester { sha256(path: string): Promise<Sha256Digest>; }
```

`src/application/ports/BinaryInstallation.ts`:

```ts
import type { BinaryPin } from "../../domain/distribution/BinaryPin.ts";

export interface BinaryInstallation {
  pathOf(pin: BinaryPin): string;
  stagingPathOf(pin: BinaryPin): string;
  exists(pin: BinaryPin): boolean;
  commit(pin: BinaryPin): void;
  discard(pin: BinaryPin): void;
}
```

`src/application/use-cases/InstallPinnedBinaries.ts`:

```ts
import { DomainError } from "../../domain/shared/DomainError.ts";
import type { BinaryName } from "../../domain/distribution/BinaryName.ts";
import type { BinaryPin } from "../../domain/distribution/BinaryPin.ts";
import type { PinSet } from "../../domain/distribution/PinSet.ts";
import type { Target } from "../../domain/distribution/Target.ts";
import type { BinaryInstallation } from "../ports/BinaryInstallation.ts";
import type { FileDigester } from "../ports/FileDigester.ts";
import type { ReleaseDownloader } from "../ports/ReleaseDownloader.ts";

export class InstallPinnedBinaries {
  readonly #pins: PinSet; readonly #target: Target; readonly #downloader: ReleaseDownloader;
  readonly #digester: FileDigester; readonly #installation: BinaryInstallation;

  constructor(pins: PinSet, target: Target, downloader: ReleaseDownloader, digester: FileDigester, installation: BinaryInstallation) {
    this.#pins = pins; this.#target = target; this.#downloader = downloader; this.#digester = digester; this.#installation = installation;
  }

  async execute(): Promise<{ name: BinaryName; path: string; action: "verified" | "installed" }[]> {
    const results: { name: BinaryName; path: string; action: "verified" | "installed" }[] = [];
    for (const pin of this.#pins.binaries()) {
      const expected = pin.digestFor(this.#target);
      const path = this.#installation.pathOf(pin);
      if (this.#installation.exists(pin) && (await this.#digester.sha256(path)).equals(expected)) {
        results.push({ name: pin.name, path, action: "verified" });
        continue;
      }
      await this.#installFresh(pin);
      results.push({ name: pin.name, path, action: "installed" });
    }
    return results;
  }

  async #installFresh(pin: BinaryPin): Promise<void> {
    const staging = this.#installation.stagingPathOf(pin);
    try {
      await this.#downloader.download(pin.releaseUrl(this.#target), staging);
      const actual = await this.#digester.sha256(staging);
      if (!actual.equals(pin.digestFor(this.#target))) throw DomainError.because(`sha256 mismatch for ${pin.name}: ${actual}`);
      this.#installation.commit(pin);
    } catch (e) {
      this.#installation.discard(pin);
      throw e;
    }
  }
}
```

`src/adapters/outbound/fs/NodeFileDigester.ts`:

```ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { FileDigester } from "../../../application/ports/FileDigester.ts";
import { Sha256Digest } from "../../../domain/distribution/Sha256Digest.ts";

export class NodeFileDigester implements FileDigester {
  async sha256(path: string): Promise<Sha256Digest> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return Sha256Digest.of(hash.digest("hex"));
  }
}
```

`src/adapters/outbound/fs/FsBinaryInstallation.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BinaryInstallation } from "../../../application/ports/BinaryInstallation.ts";
import type { BinaryPin } from "../../../domain/distribution/BinaryPin.ts";

export class FsBinaryInstallation implements BinaryInstallation {
  readonly #dir: string;
  constructor(dir: string) { this.#dir = dir; mkdirSync(dir, { recursive: true }); }
  pathOf(pin: BinaryPin): string { return join(this.#dir, pin.installedFileName()); }
  stagingPathOf(pin: BinaryPin): string { return join(this.#dir, `.${pin.installedFileName()}.partial`); }
  exists(pin: BinaryPin): boolean { return existsSync(this.pathOf(pin)); }
  commit(pin: BinaryPin): void { chmodSync(this.stagingPathOf(pin), 0o755); renameSync(this.stagingPathOf(pin), this.pathOf(pin)); }
  discard(pin: BinaryPin): void { rmSync(this.stagingPathOf(pin), { force: true }); }
}
```

`src/adapters/outbound/github/GithubReleaseDownloader.ts`. No tiene test unitario porque hace red; lo cubre la aceptación de la Task 13. Aun así cuenta para la cobertura, así que el test de la Task 2 lo ejercita con un servidor `node:http` local:

```ts
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReleaseDownloader } from "../../../application/ports/ReleaseDownloader.ts";

export class GithubReleaseDownloader implements ReleaseDownloader {
  async download(url: URL, to: string): Promise<void> {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url.href}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
  }
}
```

Añadir a `FsBinaryInstallation.test.ts`:

```ts
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { GithubReleaseDownloader } from "../../../../../src/adapters/outbound/github/GithubReleaseDownloader.ts";

test("GithubReleaseDownloader escribe el cuerpo y falla con estados de error", async () => {
  const server = createServer((req, res) => { if (req.url === "/ok") res.end("payload"); else { res.statusCode = 404; res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  const to = join(mkdtempSync(join(tmpdir(), "dl-")), "f");
  try {
    await new GithubReleaseDownloader().download(new URL(`http://127.0.0.1:${port}/ok`), to);
    assert.equal(readFileSync(to, "utf8"), "payload");
    await assert.rejects(new GithubReleaseDownloader().download(new URL(`http://127.0.0.1:${port}/missing`), to), /404/);
  } finally { server.close(); }
});
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(dist): caso de uso InstallPinnedBinaries con descarga verificada y atómica"
```

---

### Task 3: Auditoría OSV e instalación de Pi con excepción acotada

**Files:**
- Create:
  - dominio: `src/domain/distribution/{PackageCoordinate,AdvisoryId,VulnerabilityFinding,AuditReport}.ts`
  - aplicación: `src/application/dto/ShrinkwrapDto.ts`, `src/application/mappers/ShrinkwrapMapper.ts`, `src/application/ports/VulnerabilityDatabase.ts`, `src/application/use-cases/AuditDependencyTree.ts`
  - adaptador: `src/adapters/outbound/osv/OsvVulnerabilityDatabase.ts`
  - scripts: `bin/osv-audit.ts`, `scripts/install-pi.sh`
- Test: `tests/unit/domain/distribution/audit.test.ts`, `tests/unit/application/use-cases/AuditDependencyTree.test.ts`, `tests/unit/adapters/outbound/osv/OsvVulnerabilityDatabase.test.ts`, `tests/fixtures/shrinkwrap-small.json`

**Interfaces:**
- Produces:
  - `PackageCoordinate.of(name: NpmPackageName, version: SemVer)`, con `key(): string`
  - `AdvisoryId.of(raw)`
  - `VulnerabilityFinding.of(coordinate: PackageCoordinate, advisories: AdvisoryId[])`
  - `AuditReport.of(audited: number, findings: VulnerabilityFinding[])`, con `isClean(): boolean` y `findings(): VulnerabilityFinding[]`
  - `type ShrinkwrapDto = { packages?: Record<string, { version?: string; link?: boolean }> }`
  - `ShrinkwrapMapper.toCoordinates(dto: ShrinkwrapDto): PackageCoordinate[]`: sin la raíz ni los links y deduplicado
  - `interface VulnerabilityDatabase { findingsFor(batch: PackageCoordinate[]): Promise<VulnerabilityFinding[]> }` (máximo 500 por lote)
  - `AuditDependencyTree`:
    - `constructor(db: VulnerabilityDatabase)`
    - `execute(coordinates: PackageCoordinate[]): Promise<AuditReport>`: trocea en lotes de 500
  - `OsvVulnerabilityDatabase` con `constructor(endpoint = new URL("https://api.osv.dev/v1/querybatch"))`

- [ ] **Step 1: Fixture** `tests/fixtures/shrinkwrap-small.json`

```json
{ "lockfileVersion": 3, "packages": {
  "": { "name": "@earendil-works/pi-coding-agent", "version": "0.87.1" },
  "node_modules/jiti": { "version": "2.7.0" },
  "node_modules/chalk": { "version": "5.4.1" },
  "node_modules/foo/node_modules/chalk": { "version": "4.1.2" },
  "node_modules/bar/node_modules/chalk": { "version": "4.1.2" },
  "node_modules/@scope/pkg": { "version": "1.0.0", "link": true } } }
```

- [ ] **Step 2: Tests que fallan**

`tests/unit/domain/distribution/audit.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PackageCoordinate } from "../../../../src/domain/distribution/PackageCoordinate.ts";
import { AdvisoryId } from "../../../../src/domain/distribution/AdvisoryId.ts";
import { VulnerabilityFinding } from "../../../../src/domain/distribution/VulnerabilityFinding.ts";
import { AuditReport } from "../../../../src/domain/distribution/AuditReport.ts";
import { NpmPackageName } from "../../../../src/domain/distribution/NpmPackageName.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const coord = PackageCoordinate.of(NpmPackageName.of("chalk"), SemVer.of("5.4.1"));

test("coordenada, aviso y informe", () => {
  assert.equal(coord.key(), "chalk@5.4.1");
  assert.throws(() => AdvisoryId.of(" "), DomainError);
  assert.throws(() => VulnerabilityFinding.of(coord, []), /at least one advisory/);
  const report = AuditReport.of(3, [VulnerabilityFinding.of(coord, [AdvisoryId.of("GHSA-1")])]);
  assert.equal(report.isClean(), false);
  assert.equal(report.audited, 3);
  assert.equal(AuditReport.of(3, []).isClean(), true);
});
```

`tests/unit/application/use-cases/AuditDependencyTree.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuditDependencyTree } from "../../../../src/application/use-cases/AuditDependencyTree.ts";
import { ShrinkwrapMapper } from "../../../../src/application/mappers/ShrinkwrapMapper.ts";
import { VulnerabilityFinding } from "../../../../src/domain/distribution/VulnerabilityFinding.ts";
import { AdvisoryId } from "../../../../src/domain/distribution/AdvisoryId.ts";
import { PackageCoordinate } from "../../../../src/domain/distribution/PackageCoordinate.ts";
import { NpmPackageName } from "../../../../src/domain/distribution/NpmPackageName.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";

const dto = JSON.parse(readFileSync(new URL("../../../fixtures/shrinkwrap-small.json", import.meta.url), "utf8"));

test("el mapper deduplica, omite raíz y links", () => {
  assert.deepEqual(new ShrinkwrapMapper().toCoordinates(dto).map((c) => c.key()).sort(), ["chalk@4.1.2", "chalk@5.4.1", "jiti@2.7.0"]);
});

test("informa de hallazgos y trocea en lotes de 500", async () => {
  const sizes: number[] = [];
  const db = { findingsFor: async (batch: PackageCoordinate[]) => {
    sizes.push(batch.length);
    return batch.filter((c) => c.key() === "p7@1.0.0").map((c) => VulnerabilityFinding.of(c, [AdvisoryId.of("MAL-2025-1")]));
  } };
  const many = Array.from({ length: 1201 }, (_, i) => PackageCoordinate.of(NpmPackageName.of(`p${i}`), SemVer.of("1.0.0")));
  const report = await new AuditDependencyTree(db).execute(many);
  assert.deepEqual(sizes, [500, 500, 201]);
  assert.equal(report.audited, 1201);
  assert.deepEqual(report.findings().map((f) => f.coordinate.key()), ["p7@1.0.0"]);
});
```

`tests/unit/adapters/outbound/osv/OsvVulnerabilityDatabase.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { OsvVulnerabilityDatabase } from "../../../../../src/adapters/outbound/osv/OsvVulnerabilityDatabase.ts";
import { PackageCoordinate } from "../../../../../src/domain/distribution/PackageCoordinate.ts";
import { NpmPackageName } from "../../../../../src/domain/distribution/NpmPackageName.ts";
import { SemVer } from "../../../../../src/domain/distribution/SemVer.ts";

test("traduce la respuesta querybatch de OSV a hallazgos y propaga errores HTTP", async () => {
  let body = "";
  const server = createServer((req, res) => {
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.url === "/fail") { res.statusCode = 500; res.end(); return; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-a" }] }, {}] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  const coords = [PackageCoordinate.of(NpmPackageName.of("a"), SemVer.of("1.0.0")), PackageCoordinate.of(NpmPackageName.of("b"), SemVer.of("2.0.0"))];
  try {
    const findings = await new OsvVulnerabilityDatabase(new URL(`http://127.0.0.1:${port}/ok`)).findingsFor(coords);
    assert.deepEqual(findings.map((f) => [f.coordinate.key(), f.advisories.map(String)]), [["a@1.0.0", ["GHSA-a"]]]);
    assert.deepEqual(JSON.parse(body).queries[1], { package: { name: "b", ecosystem: "npm" }, version: "2.0.0" });
    await assert.rejects(new OsvVulnerabilityDatabase(new URL(`http://127.0.0.1:${port}/fail`)).findingsFor(coords), /500/);
  } finally { server.close(); }
});
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 4: Implementar**

`src/domain/distribution/PackageCoordinate.ts`:

```ts
import type { NpmPackageName } from "./NpmPackageName.ts";
import type { SemVer } from "./SemVer.ts";

export class PackageCoordinate {
  readonly name: NpmPackageName; readonly version: SemVer;
  private constructor(name: NpmPackageName, version: SemVer) { this.name = name; this.version = version; }
  static of(name: NpmPackageName, version: SemVer): PackageCoordinate { return new PackageCoordinate(name, version); }
  key(): string { return `${this.name}@${this.version}`; }
}
```

`src/domain/distribution/AdvisoryId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class AdvisoryId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): AdvisoryId {
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(raw.trim())) throw DomainError.because(`invalid advisory id "${raw}"`);
    return new AdvisoryId(raw.trim());
  }
}
```

`src/domain/distribution/VulnerabilityFinding.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { AdvisoryId } from "./AdvisoryId.ts";
import type { PackageCoordinate } from "./PackageCoordinate.ts";

export class VulnerabilityFinding {
  readonly coordinate: PackageCoordinate; readonly advisories: readonly AdvisoryId[];
  private constructor(c: PackageCoordinate, a: AdvisoryId[]) { this.coordinate = c; this.advisories = a; }
  static of(coordinate: PackageCoordinate, advisories: AdvisoryId[]): VulnerabilityFinding {
    if (advisories.length === 0) throw DomainError.because("a finding needs at least one advisory");
    return new VulnerabilityFinding(coordinate, advisories);
  }
}
```

`src/domain/distribution/AuditReport.ts`:

```ts
import type { VulnerabilityFinding } from "./VulnerabilityFinding.ts";

export class AuditReport {
  readonly audited: number; readonly #findings: VulnerabilityFinding[];
  private constructor(audited: number, findings: VulnerabilityFinding[]) { this.audited = audited; this.#findings = findings; }
  static of(audited: number, findings: VulnerabilityFinding[]): AuditReport { return new AuditReport(audited, findings); }
  isClean(): boolean { return this.#findings.length === 0; }
  findings(): VulnerabilityFinding[] { return [...this.#findings]; }
}
```

`src/application/dto/ShrinkwrapDto.ts`:

```ts
export type ShrinkwrapDto = { packages?: Record<string, { version?: string; link?: boolean }> };
```

`src/application/mappers/ShrinkwrapMapper.ts`:

```ts
import { NpmPackageName } from "../../domain/distribution/NpmPackageName.ts";
import { PackageCoordinate } from "../../domain/distribution/PackageCoordinate.ts";
import { SemVer } from "../../domain/distribution/SemVer.ts";
import type { ShrinkwrapDto } from "../dto/ShrinkwrapDto.ts";

export class ShrinkwrapMapper {
  toCoordinates(dto: ShrinkwrapDto): PackageCoordinate[] {
    const seen = new Map<string, PackageCoordinate>();
    for (const [path, entry] of Object.entries(dto.packages ?? {})) {
      if (path === "" || entry.link || !entry.version) continue;
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const c = PackageCoordinate.of(NpmPackageName.of(name), SemVer.of(entry.version));
      seen.set(c.key(), c);
    }
    return [...seen.values()];
  }
}
```

`src/application/ports/VulnerabilityDatabase.ts`:

```ts
import type { PackageCoordinate } from "../../domain/distribution/PackageCoordinate.ts";
import type { VulnerabilityFinding } from "../../domain/distribution/VulnerabilityFinding.ts";

export interface VulnerabilityDatabase { findingsFor(batch: PackageCoordinate[]): Promise<VulnerabilityFinding[]>; }
```

`src/application/use-cases/AuditDependencyTree.ts`:

```ts
import { AuditReport } from "../../domain/distribution/AuditReport.ts";
import type { PackageCoordinate } from "../../domain/distribution/PackageCoordinate.ts";
import type { VulnerabilityFinding } from "../../domain/distribution/VulnerabilityFinding.ts";
import type { VulnerabilityDatabase } from "../ports/VulnerabilityDatabase.ts";

const BATCH = 500;

export class AuditDependencyTree {
  readonly #db: VulnerabilityDatabase;
  constructor(db: VulnerabilityDatabase) { this.#db = db; }
  async execute(coordinates: PackageCoordinate[]): Promise<AuditReport> {
    const findings: VulnerabilityFinding[] = [];
    for (let i = 0; i < coordinates.length; i += BATCH) findings.push(...(await this.#db.findingsFor(coordinates.slice(i, i + BATCH))));
    return AuditReport.of(coordinates.length, findings);
  }
}
```

`src/adapters/outbound/osv/OsvVulnerabilityDatabase.ts`:

```ts
import type { VulnerabilityDatabase } from "../../../application/ports/VulnerabilityDatabase.ts";
import { AdvisoryId } from "../../../domain/distribution/AdvisoryId.ts";
import type { PackageCoordinate } from "../../../domain/distribution/PackageCoordinate.ts";
import { VulnerabilityFinding } from "../../../domain/distribution/VulnerabilityFinding.ts";

export class OsvVulnerabilityDatabase implements VulnerabilityDatabase {
  readonly #endpoint: URL;
  constructor(endpoint = new URL("https://api.osv.dev/v1/querybatch")) { this.#endpoint = endpoint; }

  async findingsFor(batch: PackageCoordinate[]): Promise<VulnerabilityFinding[]> {
    const res = await fetch(this.#endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: batch.map((c) => ({ package: { name: c.name.value, ecosystem: "npm" }, version: c.version.value })) }),
    });
    if (!res.ok) throw new Error(`OSV querybatch failed: ${res.status}`);
    const { results } = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    return results.flatMap((r, i) => (r.vulns?.length ? [VulnerabilityFinding.of(batch[i], r.vulns.map((v) => AdvisoryId.of(v.id)))] : []));
  }
}
```

`bin/osv-audit.ts`, un entry point sin clases:

```ts
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ShrinkwrapMapper } from "../src/application/mappers/ShrinkwrapMapper.ts";
import { AuditDependencyTree } from "../src/application/use-cases/AuditDependencyTree.ts";
import { OsvVulnerabilityDatabase } from "../src/adapters/outbound/osv/OsvVulnerabilityDatabase.ts";

const file = process.argv[2];
if (!file) { console.error("usage: osv-audit <npm-shrinkwrap.json>"); process.exit(2); }
try {
  const coords = new ShrinkwrapMapper().toCoordinates(JSON.parse(readFileSync(file, "utf8")));
  const report = await new AuditDependencyTree(new OsvVulnerabilityDatabase()).execute(coords);
  console.log(JSON.stringify({ audited: report.audited, findings: report.findings().map((f) => ({ package: f.coordinate.key(), advisories: f.advisories.map(String) })) }, null, 2));
  process.exit(report.isClean() ? 0 : 1);
} catch (e) { console.error(String(e)); process.exit(2); }
```

`scripts/install-pi.sh`:

```bash
#!/usr/bin/env bash
# Excepción acotada aprobada (28 sept 2026): Pi y su árbol entran por npm, sin
# scripts de instalación, con el shrinkwrap publicado, integridad comprobada y
# auditoría OSV antes de exponer `pi`.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
pins="${here}/pins.json"
pkg="$(node -e 'console.log(require(process.argv[1]).pi.package)' "$pins")"
ver="$(node -e 'console.log(require(process.argv[1]).pi.version)' "$pins")"
want="$(node -e 'console.log(require(process.argv[1]).pi.integrity)' "$pins")"
prefix="${UNDERPASS_PI_PREFIX:-${XDG_DATA_HOME:-$HOME/.local/share}/underpass-pi/pi-${ver}}"
staging="${prefix}.staging"

got="$(npm view "${pkg}@${ver}" dist.integrity)"
[[ "$got" == "$want" ]] || { echo "install-pi: integrity mismatch: $got" >&2; exit 1; }

rm -rf "$staging"
npm install -g --ignore-scripts --no-audit --no-fund --prefix "$staging" "${pkg}@${ver}"
shrink="${staging}/lib/node_modules/${pkg}/npm-shrinkwrap.json"
[[ -f "$shrink" ]] || { echo "install-pi: published shrinkwrap missing" >&2; exit 1; }
node "${here}/bin/osv-audit.ts" "$shrink" > "${staging}/osv-audit.json" || {
  echo "install-pi: OSV audit not clean; see ${staging}/osv-audit.json" >&2; exit 1; }

rm -rf "$prefix" && mv "$staging" "$prefix"
mkdir -p "$HOME/.local/bin" && ln -sfn "${prefix}/bin/pi" "$HOME/.local/bin/pi"
echo "install-pi: ${pkg}@${ver} installed at ${prefix} (OSV clean)"
```

- [ ] **Step 5: Ejecutar tests y el script real**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

Run: `bash scripts/install-pi.sh && pi --version`
Expected: `(OSV clean)` y `0.87.1`. **Si la auditoría OSV no está limpia, se para aquí** y se le lleva al usuario `osv-audit.json`.

- [ ] **Step 6: Commit**

```bash
git add src tests bin/osv-audit.ts scripts/install-pi.sh
git commit -m "feat(dist): auditoría OSV del árbol de Pi e instalación con excepción acotada"
```

---

### Task 4: Dominio MCP, DTOs y mappers

**Files:**
- Create:
  - dominio: `src/domain/mcp/{ServerName,ToolName,ToolDescription,JsonSchema,ToolDescriptor,ProtocolVersion,ServerIdentity,CatalogFingerprint,ToolCatalog,RefusalCode,ToolSuccess,ToolRefusal,ToolOutcome}.ts`
  - aplicación: `src/application/dto/{McpToolDto,McpToolResultDto,CatalogDto,ToolCallResultDto}.ts`, `src/application/mappers/{McpToolMapper,ToolOutcomeMapper,CatalogMapper}.ts`
- Test: `tests/unit/domain/mcp/mcp.test.ts`, `tests/unit/application/mappers/mcp-mappers.test.ts`

**Interfaces:**
- Produces:
  - `ServerName.KMP`, `ServerName.MADE`, `ServerName.of(raw)`
  - `ToolName.of(raw)`, `hasPrefix(prefix: string): boolean`
  - `ToolDescription.of(raw)` (texto no vacío; si falta, el nombre)
  - `JsonSchema.of(obj: Record<string, unknown>)`, con `canonical(): string` y `toJson(): Record<string, unknown>`
  - `ToolDescriptor.of(name, description, schema)`
  - `ProtocolVersion.of(raw)`, `ProtocolVersion.MCP_2024_11_05`
  - `ServerIdentity.of(name: string, version: SemVer)`
  - `CatalogFingerprint.of(raw)`, `CatalogFingerprint.digest(canonical: string)`
  - `ToolCatalog.of(server, identity, tools)`, con `fingerprint(): CatalogFingerprint`, `has(name): boolean`, `names(): ToolName[]` y `tools(): ToolDescriptor[]`
  - `RefusalCode.of(raw)`, `RefusalCode.UNKNOWN`
  - `ToolSuccess.of(structured: unknown, text: string)` (`structured` es JSON opaco)
  - `ToolRefusal.of(code: RefusalCode, message: string, retryable: boolean)`
  - `type ToolOutcome = ToolSuccess | ToolRefusal`
  - `McpToolDto = { name: string; description?: string; inputSchema: Record<string, unknown> }`
  - `McpToolResultDto = { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }`
  - `CatalogDto = { server: string; serverName: string; serverVersion: string; fingerprint: string; tools: McpToolDto[] }`
  - `ToolCallResultDto = { structured: unknown; text: string }`
  - `McpToolMapper.toDomain(dto): ToolDescriptor` y `toDto(d): McpToolDto`
  - `ToolOutcomeMapper.toDomain(dto: McpToolResultDto): ToolOutcome` y `toDto(s: ToolSuccess): ToolCallResultDto`
  - `CatalogMapper.toDto(c: ToolCatalog): CatalogDto` y `toDomain(dto: CatalogDto): ToolCatalog`

- [ ] **Step 1: Tests que fallan**

`tests/unit/domain/mcp/mcp.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolDescription } from "../../../../src/domain/mcp/ToolDescription.ts";
import { JsonSchema } from "../../../../src/domain/mcp/JsonSchema.ts";
import { ToolDescriptor } from "../../../../src/domain/mcp/ToolDescriptor.ts";
import { ProtocolVersion } from "../../../../src/domain/mcp/ProtocolVersion.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { CatalogFingerprint } from "../../../../src/domain/mcp/CatalogFingerprint.ts";
import { RefusalCode } from "../../../../src/domain/mcp/RefusalCode.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const tool = (n: string, schema: Record<string, unknown> = { type: "object" }) => ToolDescriptor.of(ToolName.of(n), ToolDescription.of(n), JsonSchema.of(schema));
const identity = ServerIdentity.of("underpass-kmp-mcp", SemVer.of("0.24.0"));

test("VOs MCP validan", () => {
  assert.throws(() => ServerName.of("x"), DomainError);
  assert.throws(() => ToolName.of("Bad-Name"), DomainError);
  assert.throws(() => ToolDescription.of(""), DomainError);
  assert.throws(() => ProtocolVersion.of("v1"), DomainError);
  assert.throws(() => CatalogFingerprint.of("x"), DomainError);
  assert.throws(() => RefusalCode.of(""), DomainError);
  assert.ok(ToolName.of("kmp_ask").hasPrefix("kmp_"));
  assert.ok(ServerName.of("made").equals(ServerName.MADE));
  assert.equal(ProtocolVersion.MCP_2024_11_05.value, "2024-11-05");
});

test("JsonSchema canónico independiente del orden de claves", () => {
  assert.equal(JsonSchema.of({ b: 1, a: { d: 2, c: [1, { f: 0, e: 1 }] } }).canonical(), JsonSchema.of({ a: { c: [1, { e: 1, f: 0 }], d: 2 }, b: 1 }).canonical());
});

test("ToolCatalog: huella estable y sensible a esquemas; rechaza duplicados", () => {
  const a = ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_b", { type: "object", properties: { y: {}, x: {} } }), tool("kmp_a")]);
  const b = ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_a"), tool("kmp_b", { properties: { x: {}, y: {} }, type: "object" })]);
  const c = ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_a", { type: "object", required: ["q"] }), tool("kmp_b")]);
  assert.ok(a.fingerprint().equals(b.fingerprint()));
  assert.ok(!a.fingerprint().equals(c.fingerprint()));
  assert.ok(a.has(ToolName.of("kmp_a")));
  assert.deepEqual(a.names().map(String), ["kmp_a", "kmp_b"]);
  assert.throws(() => ToolCatalog.of(ServerName.KMP, identity, [tool("kmp_a"), tool("kmp_a")]), /duplicate/);
});

test("resultados", () => {
  const r = ToolRefusal.of(RefusalCode.of("conflict"), "stale", false);
  assert.equal(r.describe(), "conflict: stale");
  assert.equal(ToolSuccess.of({ a: 1 }, "t").text, "t");
  assert.equal(ToolSuccess.of(null, "t").isSuccess(), true);
  assert.equal(r.isSuccess(), false);
});
```

`tests/unit/application/mappers/mcp-mappers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolOutcomeMapper } from "../../../../src/application/mappers/ToolOutcomeMapper.ts";
import { McpToolMapper } from "../../../../src/application/mappers/McpToolMapper.ts";
import { CatalogMapper } from "../../../../src/application/mappers/CatalogMapper.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";

const outcomes = new ToolOutcomeMapper();

test("éxito y resultado de app sin isError", () => {
  const ok = outcomes.toDomain({ content: [{ type: "text", text: "hi" }], structuredContent: { a: 1 }, isError: false });
  assert.ok(ok instanceof ToolSuccess);
  assert.deepEqual(outcomes.toDto(ok as ToolSuccess), { structured: { a: 1 }, text: "hi" });
  assert.ok(outcomes.toDomain({ content: [], structuredContent: { v: 1 } }) instanceof ToolSuccess);
});

test("negativa KMP, negativa MADE e isError sin estructura", () => {
  const kmp = outcomes.toDomain({ content: [{ type: "text", text: "t" }], structuredContent: { error: { code: "conflict", message: "stale" } }, isError: true }) as ToolRefusal;
  assert.deepEqual([kmp.code.value, kmp.message, kmp.retryable], ["conflict", "stale", false]);
  const made = outcomes.toDomain({ content: [], structuredContent: { code: "unavailable", message: "busy", retryable: true }, isError: true }) as ToolRefusal;
  assert.deepEqual([made.code.value, made.retryable], ["unavailable", true]);
  const bare = outcomes.toDomain({ content: [{ type: "text", text: "boom" }], isError: true }) as ToolRefusal;
  assert.deepEqual([bare.code.value, bare.message], ["unknown", "boom"]);
});

test("catálogo ida y vuelta conserva la huella", () => {
  const tools = [{ name: "kmp_ask", description: "Ask", inputSchema: { type: "object" } }, { name: "kmp_wake", inputSchema: { type: "object" } }].map((d) => new McpToolMapper().toDomain(d));
  const cat = ToolCatalog.of(ServerName.KMP, ServerIdentity.of("underpass-kmp-mcp", SemVer.of("0.24.0")), tools);
  const dto = new CatalogMapper().toDto(cat);
  assert.equal(dto.tools[1].description, "kmp_wake");
  assert.ok(new CatalogMapper().toDomain(dto).fingerprint().equals(cat.fingerprint()));
  assert.equal(dto.fingerprint, cat.fingerprint().value);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar el dominio**

`src/domain/mcp/ServerName.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ServerName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly KMP = new ServerName("kmp");
  static readonly MADE = new ServerName("made");
  static of(raw: string): ServerName {
    if (raw === "kmp") return ServerName.KMP;
    if (raw === "made") return ServerName.MADE;
    throw DomainError.because(`unknown server ${raw}`);
  }
}
```

`src/domain/mcp/ToolName.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ToolName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ToolName {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(raw)) throw DomainError.because(`invalid tool name ${raw}`);
    return new ToolName(raw);
  }
  hasPrefix(prefix: string): boolean { return this.value.startsWith(prefix); }
}
```

`src/domain/mcp/ToolDescription.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ToolDescription extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ToolDescription {
    if (!raw.trim()) throw DomainError.because("tool description must not be empty");
    return new ToolDescription(raw);
  }
}
```

`src/domain/mcp/JsonSchema.ts`:

```ts
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]));
  return v;
}

export class JsonSchema {
  readonly #schema: Record<string, unknown>;
  private constructor(s: Record<string, unknown>) { this.#schema = s; }
  static of(schema: Record<string, unknown>): JsonSchema { return new JsonSchema(structuredClone(schema)); }
  canonical(): string { return JSON.stringify(canonicalize(this.#schema)); }
  toJson(): Record<string, unknown> { return structuredClone(this.#schema); }
}
```

`src/domain/mcp/ToolDescriptor.ts`:

```ts
import type { JsonSchema } from "./JsonSchema.ts";
import type { ToolDescription } from "./ToolDescription.ts";
import type { ToolName } from "./ToolName.ts";

export class ToolDescriptor {
  readonly name: ToolName; readonly description: ToolDescription; readonly schema: JsonSchema;
  private constructor(n: ToolName, d: ToolDescription, s: JsonSchema) { this.name = n; this.description = d; this.schema = s; }
  static of(name: ToolName, description: ToolDescription, schema: JsonSchema): ToolDescriptor { return new ToolDescriptor(name, description, schema); }
}
```

`src/domain/mcp/ProtocolVersion.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ProtocolVersion extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly MCP_2024_11_05 = new ProtocolVersion("2024-11-05");
  static of(raw: string): ProtocolVersion {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw DomainError.because(`invalid MCP protocol version ${raw}`);
    return new ProtocolVersion(raw);
  }
}
```

`src/domain/mcp/ServerIdentity.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { SemVer } from "../distribution/SemVer.ts";

export class ServerIdentity {
  readonly name: string; readonly version: SemVer;
  private constructor(name: string, version: SemVer) { this.name = name; this.version = version; }
  static of(name: string, version: SemVer): ServerIdentity {
    if (!name.trim()) throw DomainError.because("server name must not be empty");
    return new ServerIdentity(name, version);
  }
}
```

`src/domain/mcp/CatalogFingerprint.ts`:

```ts
import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CatalogFingerprint extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CatalogFingerprint {
    if (!/^[0-9a-f]{64}$/.test(raw)) throw DomainError.because("catalog fingerprint must be 64 hex characters");
    return new CatalogFingerprint(raw);
  }
  static digest(canonical: string): CatalogFingerprint { return new CatalogFingerprint(createHash("sha256").update(canonical).digest("hex")); }
  short(): string { return this.value.slice(0, 12); }
}
```

`src/domain/mcp/ToolCatalog.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { CatalogFingerprint } from "./CatalogFingerprint.ts";
import type { ServerIdentity } from "./ServerIdentity.ts";
import type { ServerName } from "./ServerName.ts";
import type { ToolDescriptor } from "./ToolDescriptor.ts";
import type { ToolName } from "./ToolName.ts";

export class ToolCatalog {
  readonly server: ServerName; readonly identity: ServerIdentity; readonly #tools: ToolDescriptor[];
  private constructor(s: ServerName, i: ServerIdentity, t: ToolDescriptor[]) { this.server = s; this.identity = i; this.#tools = t; }

  static of(server: ServerName, identity: ServerIdentity, tools: ToolDescriptor[]): ToolCatalog {
    const names = tools.map((t) => t.name.value);
    if (new Set(names).size !== names.length) throw DomainError.because(`duplicate tool in ${server} catalog`);
    return new ToolCatalog(server, identity, [...tools].sort((a, b) => a.name.value.localeCompare(b.name.value)));
  }

  fingerprint(): CatalogFingerprint {
    return CatalogFingerprint.digest(JSON.stringify(this.#tools.map((t) => [t.name.value, t.schema.canonical()])));
  }
  has(name: ToolName): boolean { return this.#tools.some((t) => t.name.equals(name)); }
  names(): ToolName[] { return this.#tools.map((t) => t.name); }
  tools(): ToolDescriptor[] { return [...this.#tools]; }
}
```

`src/domain/mcp/RefusalCode.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class RefusalCode extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly UNKNOWN = new RefusalCode("unknown");
  static of(raw: string): RefusalCode {
    if (!/^[a-z][a-z0-9_]*$/.test(raw)) throw DomainError.because(`invalid refusal code "${raw}"`);
    return new RefusalCode(raw);
  }
}
```

`src/domain/mcp/ToolSuccess.ts`:

```ts
export class ToolSuccess {
  readonly structured: unknown; readonly text: string;
  private constructor(s: unknown, t: string) { this.structured = s; this.text = t; }
  static of(structured: unknown, text: string): ToolSuccess { return new ToolSuccess(structured, text); }
  isSuccess(): this is ToolSuccess { return true; }
}
```

`src/domain/mcp/ToolRefusal.ts`:

```ts
import type { RefusalCode } from "./RefusalCode.ts";

export class ToolRefusal {
  readonly code: RefusalCode; readonly message: string; readonly retryable: boolean;
  private constructor(c: RefusalCode, m: string, r: boolean) { this.code = c; this.message = m; this.retryable = r; }
  static of(code: RefusalCode, message: string, retryable: boolean): ToolRefusal { return new ToolRefusal(code, message, retryable); }
  isSuccess(): false { return false; }
  describe(): string { return `${this.code}: ${this.message}`; }
}
```

`src/domain/mcp/ToolOutcome.ts`:

```ts
import type { ToolRefusal } from "./ToolRefusal.ts";
import type { ToolSuccess } from "./ToolSuccess.ts";

export type ToolOutcome = ToolSuccess | ToolRefusal;
```

- [ ] **Step 4: Implementar DTOs y mappers**

`src/application/dto/McpToolDto.ts`:

```ts
export type McpToolDto = { name: string; description?: string; inputSchema: Record<string, unknown> };
```

`src/application/dto/McpToolResultDto.ts`:

```ts
export type McpToolResultDto = { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
```

`src/application/dto/CatalogDto.ts`:

```ts
import type { McpToolDto } from "./McpToolDto.ts";

export type CatalogDto = { server: string; serverName: string; serverVersion: string; fingerprint: string; tools: McpToolDto[] };
```

`src/application/dto/ToolCallResultDto.ts`:

```ts
export type ToolCallResultDto = { structured: unknown; text: string };
```

`src/application/mappers/McpToolMapper.ts`:

```ts
import { JsonSchema } from "../../domain/mcp/JsonSchema.ts";
import { ToolDescription } from "../../domain/mcp/ToolDescription.ts";
import { ToolDescriptor } from "../../domain/mcp/ToolDescriptor.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import type { McpToolDto } from "../dto/McpToolDto.ts";

export class McpToolMapper {
  toDomain(dto: McpToolDto): ToolDescriptor {
    return ToolDescriptor.of(ToolName.of(dto.name), ToolDescription.of(dto.description?.trim() ? dto.description : dto.name), JsonSchema.of(dto.inputSchema ?? { type: "object" }));
  }
  toDto(d: ToolDescriptor): McpToolDto { return { name: d.name.value, description: d.description.value, inputSchema: d.schema.toJson() }; }
}
```

`src/application/mappers/ToolOutcomeMapper.ts`:

```ts
import { RefusalCode } from "../../domain/mcp/RefusalCode.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../domain/mcp/ToolSuccess.ts";
import type { McpToolResultDto } from "../dto/McpToolResultDto.ts";
import type { ToolCallResultDto } from "../dto/ToolCallResultDto.ts";

export class ToolOutcomeMapper {
  toDomain(dto: McpToolResultDto): ToolOutcome {
    const text = (dto.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const s = dto.structuredContent;
    if (dto.isError !== true) return ToolSuccess.of(s, text);
    const kmp = s?.error as { code?: string; message?: string } | undefined; // KMP
    const rawCode = kmp?.code ?? (s?.code as string | undefined);          // MADE
    const code = rawCode ? RefusalCode.of(rawCode) : RefusalCode.UNKNOWN;
    return ToolRefusal.of(code, kmp?.message ?? (s?.message as string | undefined) ?? text, s?.retryable === true);
  }
  toDto(success: ToolSuccess): ToolCallResultDto { return { structured: success.structured, text: success.text }; }
}
```

`src/application/mappers/CatalogMapper.ts`:

```ts
import { SemVer } from "../../domain/distribution/SemVer.ts";
import { ServerIdentity } from "../../domain/mcp/ServerIdentity.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
import { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { CatalogDto } from "../dto/CatalogDto.ts";
import { McpToolMapper } from "./McpToolMapper.ts";

export class CatalogMapper {
  readonly #tools = new McpToolMapper();
  toDto(c: ToolCatalog): CatalogDto {
    return { server: c.server.value, serverName: c.identity.name, serverVersion: c.identity.version.value, fingerprint: c.fingerprint().value, tools: c.tools().map((t) => this.#tools.toDto(t)) };
  }
  toDomain(dto: CatalogDto): ToolCatalog {
    return ToolCatalog.of(ServerName.of(dto.server), ServerIdentity.of(dto.serverName, SemVer.of(dto.serverVersion)), dto.tools.map((t) => this.#tools.toDomain(t)));
  }
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat(dominio): catálogo MCP, huella canónica y resultados como value objects"
```

---

### Task 5: Adaptador MCP stdio

**Files:**
- Create:
  - puertos: `src/application/ports/{McpConnection,McpConnector}.ts`
  - DTO: `src/application/dto/ServerCommandDto.ts`
  - adaptadores: `src/adapters/outbound/mcp/{McpRpcError,McpTransportError,StdioMcpConnection,StdioMcpConnector}.ts`
  - fixture: `tests/fixtures/fake-mcp-server.ts`
- Test: `tests/unit/adapters/outbound/mcp/StdioMcpConnection.test.ts`

**Interfaces:**
- Consumes: `ToolCatalog`, `ToolOutcome`, `ServerName`, `ServerIdentity`, `ProtocolVersion`, mappers (Task 4)
- Produces:
  - `type ServerCommandDto = { command: string; args: string[]; env: Record<string, string | undefined>; cwd: string }`
  - `interface McpConnection`:
    - `readonly server: ServerName`
    - `readonly identity: ServerIdentity`
    - `readonly protocol: ProtocolVersion`
    - `catalog(): Promise<ToolCatalog>`
    - `call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome>`
    - `onExit(listener: () => void): void`
    - `close(): Promise<void>`
  - `interface McpConnector { open(server: ServerName, command: ServerCommandDto): Promise<McpConnection> }`
  - `class McpRpcError extends Error` con `readonly code: number`
  - `class McpTransportError extends Error`
  - `StdioMcpConnector` con `constructor(requestTimeoutMs = 60_000)`

- [ ] **Step 1: Servidor falso** `tests/fixtures/fake-mcp-server.ts`

Imita lo medido en P0: respuestas en orden, versión `2024-11-05` y los dos formatos de negativa. Es una fixture, así que queda fuera de `src/` y del gate de un tipo por fichero.

```ts
#!/usr/bin/env node
import { createInterface } from "node:readline";

const flavor = process.env.FAKE_FLAVOR ?? "kmp";
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
const reply = (id: unknown, result: unknown) => out({ jsonrpc: "2.0", id, result });
const error = (id: unknown, code: number, message: string) => out({ jsonrpc: "2.0", id, error: { code, message } });
const tools = ["echo", "fail", "slow", "die"].map((n) => ({ name: `${flavor}_${n}`, description: n, inputSchema: { type: "object" } }));

for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  if (msg.id === undefined) continue;
  if (msg.method === "initialize") { reply(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: `fake-${flavor}`, version: "0.0.1" } }); continue; }
  if (msg.method === "tools/list") { reply(msg.id, { tools }); continue; }
  if (msg.method !== "tools/call") { error(msg.id, -32601, "method not found"); continue; }
  const { name, arguments: args } = msg.params;
  if (name === `${flavor}_echo`) reply(msg.id, { content: [{ type: "text", text: JSON.stringify(args) }], structuredContent: args, isError: false });
  else if (name === `${flavor}_fail` && flavor === "kmp") reply(msg.id, { content: [{ type: "text", text: "nf" }], structuredContent: { error: { code: "not_found", message: "no such ref" } }, isError: true });
  else if (name === `${flavor}_fail`) reply(msg.id, { content: [{ type: "text", text: "refused: no grant" }], structuredContent: { code: "refused", message: "no grant", retryable: false }, isError: true });
  else if (name === `${flavor}_slow`) { await new Promise((r) => setTimeout(r, 300)); reply(msg.id, { content: [{ type: "text", text: "slow" }], structuredContent: {}, isError: false }); }
  else if (name === `${flavor}_die`) process.exit(3);
  else error(msg.id, -32602, "unknown tool");
}
```

- [ ] **Step 2: Test que falla** `tests/unit/adapters/outbound/mcp/StdioMcpConnection.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { StdioMcpConnector } from "../../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { McpRpcError } from "../../../../../src/adapters/outbound/mcp/McpRpcError.ts";
import { McpTransportError } from "../../../../../src/adapters/outbound/mcp/McpTransportError.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../../src/domain/mcp/ToolName.ts";
import { ToolSuccess } from "../../../../../src/domain/mcp/ToolSuccess.ts";
import { ToolRefusal } from "../../../../../src/domain/mcp/ToolRefusal.ts";

const fake = new URL("../../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;
const open = (flavor = "kmp", timeout = 2000) =>
  new StdioMcpConnector(timeout).open(ServerName.of(flavor), { command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: flavor } });

test("handshake y catálogo", async () => {
  const c = await open();
  try {
    assert.equal(c.protocol.value, "2024-11-05");
    assert.equal(c.identity.name, "fake-kmp");
    assert.deepEqual((await c.catalog()).names().map(String), ["kmp_die", "kmp_echo", "kmp_fail", "kmp_slow"]);
  } finally { await c.close(); }
});

test("éxito, negativa y error RPC", async () => {
  const c = await open("made");
  try {
    assert.ok((await c.call(ToolName.of("made_echo"), { v: "x" })) instanceof ToolSuccess);
    const r = await c.call(ToolName.of("made_fail"), {});
    assert.ok(r instanceof ToolRefusal && r.code.value === "refused");
    await assert.rejects(c.call(ToolName.of("made_nope"), {}), (e) => e instanceof McpRpcError && e.code === -32602);
  } finally { await c.close(); }
});

test("correlación por id con peticiones en vuelo", async () => {
  const c = await open();
  try {
    const [a, b] = await Promise.all([c.call(ToolName.of("kmp_slow"), {}), c.call(ToolName.of("kmp_echo"), {})]);
    assert.ok(a instanceof ToolSuccess && b instanceof ToolSuccess);
  } finally { await c.close(); }
});

test("timeout y muerte del proceso son McpTransportError", async () => {
  const slow = await open("kmp", 100);
  try { await assert.rejects(slow.call(ToolName.of("kmp_slow"), {}), (e) => e instanceof McpTransportError && /outcome unknown/.test(e.message)); }
  finally { await slow.close(); }
  const dying = await open();
  let exited = false;
  dying.onExit(() => { exited = true; });
  await assert.rejects(dying.call(ToolName.of("kmp_die"), {}), McpTransportError);
  assert.equal(exited, true);
  await assert.rejects(dying.call(ToolName.of("kmp_echo"), {}), /not running/);
  await dying.close();
});
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 4: Implementar**

`src/application/dto/ServerCommandDto.ts`:

```ts
export type ServerCommandDto = { command: string; args: string[]; env: Record<string, string | undefined>; cwd: string };
```

`src/application/ports/McpConnection.ts`:

```ts
import type { ProtocolVersion } from "../../domain/mcp/ProtocolVersion.ts";
import type { ServerIdentity } from "../../domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";

export interface McpConnection {
  readonly server: ServerName;
  readonly identity: ServerIdentity;
  readonly protocol: ProtocolVersion;
  catalog(): Promise<ToolCatalog>;
  call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome>;
  onExit(listener: () => void): void;
  close(): Promise<void>;
}
```

`src/application/ports/McpConnector.ts`:

```ts
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ServerCommandDto } from "../dto/ServerCommandDto.ts";
import type { McpConnection } from "./McpConnection.ts";

export interface McpConnector { open(server: ServerName, command: ServerCommandDto): Promise<McpConnection>; }
```

`src/adapters/outbound/mcp/McpRpcError.ts`:

```ts
export class McpRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) { super(message); this.name = "McpRpcError"; this.code = code; }
}
```

`src/adapters/outbound/mcp/McpTransportError.ts`:

```ts
export class McpTransportError extends Error {
  constructor(message: string) { super(message); this.name = "McpTransportError"; }
}
```

`src/adapters/outbound/mcp/StdioMcpConnection.ts`:

```ts
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpConnection } from "../../../application/ports/McpConnection.ts";
import type { McpToolDto } from "../../../application/dto/McpToolDto.ts";
import type { McpToolResultDto } from "../../../application/dto/McpToolResultDto.ts";
import { McpToolMapper } from "../../../application/mappers/McpToolMapper.ts";
import { ToolOutcomeMapper } from "../../../application/mappers/ToolOutcomeMapper.ts";
import { SemVer } from "../../../domain/distribution/SemVer.ts";
import { ProtocolVersion } from "../../../domain/mcp/ProtocolVersion.ts";
import { ServerIdentity } from "../../../domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import { ToolCatalog } from "../../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../../domain/mcp/ToolOutcome.ts";
import { McpRpcError } from "./McpRpcError.ts";
import { McpTransportError } from "./McpTransportError.ts";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class StdioMcpConnection implements McpConnection {
  readonly server: ServerName;
  identity = ServerIdentity.of("unknown", SemVer.of("0.0.0"));
  protocol = ProtocolVersion.MCP_2024_11_05;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, Pending>();
  readonly #exitListeners: (() => void)[] = [];
  #nextId = 1;
  #exited = false;

  constructor(server: ServerName, child: ChildProcessWithoutNullStreams, timeoutMs: number) {
    this.server = server; this.#child = child; this.#timeoutMs = timeoutMs;
    createInterface({ input: child.stdout }).on("line", (l) => this.#onLine(l));
    child.on("exit", (code) => {
      this.#exited = true;
      for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new McpTransportError(`${server} exited (${code}); outcome unknown`)); }
      this.#pending.clear();
      for (const l of this.#exitListeners) l();
    });
  }

  async handshake(): Promise<void> {
    const init = (await this.#request("initialize", { protocolVersion: ProtocolVersion.MCP_2024_11_05.value, capabilities: {}, clientInfo: { name: "underpass-pi", version: "0.1.0" } })) as
      { protocolVersion: string; serverInfo: { name: string; version: string } };
    this.protocol = ProtocolVersion.of(init.protocolVersion);
    this.identity = ServerIdentity.of(init.serverInfo.name, SemVer.of(init.serverInfo.version));
    this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  }

  async catalog(): Promise<ToolCatalog> {
    const { tools } = (await this.#request("tools/list", {})) as { tools: McpToolDto[] };
    const mapper = new McpToolMapper();
    return ToolCatalog.of(this.server, this.identity, tools.map((t) => mapper.toDomain(t)));
  }

  async call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
    return new ToolOutcomeMapper().toDomain((await this.#request("tools/call", { name: tool.value, arguments: args })) as McpToolResultDto);
  }

  onExit(listener: () => void): void { this.#exitListeners.push(listener); }

  async close(): Promise<void> {
    if (this.#exited) return;
    const done = new Promise<void>((r) => this.#child.once("exit", () => r()));
    this.#child.stdin.end();
    const kill = setTimeout(() => this.#child.kill("SIGTERM"), 2000);
    await done;
    clearTimeout(kill);
  }

  #request(method: string, params: unknown): Promise<unknown> {
    if (this.#exited) return Promise.reject(new McpTransportError(`${this.server} not running`));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new McpTransportError(`${method} timed out after ${this.#timeoutMs}ms; outcome unknown`)); }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  #onLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string } };
    try { msg = JSON.parse(line); } catch { return; }
    const p = msg.id === undefined ? undefined : this.#pending.get(msg.id);
    if (!p) return;
    this.#pending.delete(msg.id!);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new McpRpcError(msg.error.code, msg.error.message)); else p.resolve(msg.result);
  }
}
```

`src/adapters/outbound/mcp/StdioMcpConnector.ts`:

```ts
import { spawn } from "node:child_process";
import type { McpConnector } from "../../../application/ports/McpConnector.ts";
import type { McpConnection } from "../../../application/ports/McpConnection.ts";
import type { ServerCommandDto } from "../../../application/dto/ServerCommandDto.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import { StdioMcpConnection } from "./StdioMcpConnection.ts";

export class StdioMcpConnector implements McpConnector {
  readonly #timeoutMs: number;
  constructor(requestTimeoutMs = 60_000) { this.#timeoutMs = requestTimeoutMs; }
  async open(server: ServerName, cmd: ServerCommandDto): Promise<McpConnection> {
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env, stdio: ["pipe", "pipe", "pipe"] });
    const conn = new StdioMcpConnection(server, child, this.#timeoutMs);
    await conn.handshake();
    return conn;
  }
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat(mcp): adaptador stdio con correlación por id y negativas mapeadas a dominio"
```

---

### Task 6: Perfiles de contrato y capacidades de MADE

**Files:**
- Create:
  - dominio: `src/domain/contracts/{ProfileId,ToolProfile,ProfileCheck,ToolProfiles}.ts`, `src/domain/made/{CapabilityGroupId,DeclaredLimitId,MadeCapabilities}.ts`
  - aplicación: `src/application/dto/MadeCapabilitiesDto.ts`, `src/application/mappers/MadeCapabilitiesMapper.ts`, `src/application/use-cases/VerifyServerProfiles.ts`
- Test: `tests/unit/domain/contracts/contracts.test.ts`, `tests/unit/application/mappers/MadeCapabilitiesMapper.test.ts`, `tests/unit/application/use-cases/VerifyServerProfiles.test.ts`

**Interfaces:**
- Consumes: `ToolCatalog`, `ToolName`, `ServerName` (Task 4)
- Produces:
  - `ProfileId.of(raw)` con `KMP_INTERACTIVE`, `KMP_PROJECTION`, `MADE_SESSION` y `MADE_WORKER`
  - `ToolProfile.of(id, server, required: ToolName[])`, con `check(catalog): ProfileCheck`
  - `ProfileCheck`: `profile: ProfileId`, `missing(): ToolName[]`, `isSatisfied(): boolean`
  - `ToolProfiles.standard(): ToolProfiles`, con `forServer(server): ToolProfile[]` y `byId(id)`
  - `CapabilityGroupId.of`, `DeclaredLimitId.of`, `DeclaredLimitId.ROSTER_PROCESS_LOCAL`
  - `MadeCapabilities.of({ serverVersion: SemVer; toolCount: number; groups: CapabilityGroupId[]; limits: DeclaredLimitId[]; activationAdapter: string | null })`, con `declares(limit): boolean`
  - `type MadeCapabilitiesDto = { schema_version?: string; server?: { version?: string }; tool_count?: number; capabilities?: { id: string }[]; declared_limits?: { id: string }[]; host_activation?: { adapter: string } | null }`
  - `MadeCapabilitiesMapper.toDomain(dto): MadeCapabilities`: exige `schema_version === "1.0"`
  - `VerifyServerProfiles`:
    - `constructor(profiles: ToolProfiles)`
    - `execute(catalog: ToolCatalog): ProfileCheck[]`

Las listas de tools por perfil son las de la spec. Se escriben una vez aquí, en `ToolProfiles.standard()`.

- [ ] **Step 1: Tests que fallan**

`tests/unit/domain/contracts/contracts.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { ProfileId } from "../../../../src/domain/contracts/ProfileId.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolDescriptor } from "../../../../src/domain/mcp/ToolDescriptor.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolDescription } from "../../../../src/domain/mcp/ToolDescription.ts";
import { JsonSchema } from "../../../../src/domain/mcp/JsonSchema.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const catalogWith = (server: ServerName, names: string[]) => ToolCatalog.of(server, ServerIdentity.of("s", SemVer.of("1.0.0")),
  names.map((n) => ToolDescriptor.of(ToolName.of(n), ToolDescription.of(n), JsonSchema.of({ type: "object" }))));

test("perfiles estándar por servidor", () => {
  const p = ToolProfiles.standard();
  assert.deepEqual(p.forServer(ServerName.KMP).map((x) => x.id.value), ["kmp-interactive", "kmp-projection"]);
  assert.deepEqual(p.forServer(ServerName.MADE).map((x) => x.id.value), ["made-session", "made-worker"]);
  assert.throws(() => ProfileId.of("x"), DomainError);
});

test("sin renew_ceremony_step_lease el perfil de worker no se satisface", () => {
  const worker = ToolProfiles.standard().byId(ProfileId.MADE_WORKER);
  const names = worker.required.map(String).filter((n) => n !== "made_renew_ceremony_step_lease");
  const check = worker.check(catalogWith(ServerName.MADE, names));
  assert.equal(check.isSatisfied(), false);
  assert.deepEqual(check.missing().map(String), ["made_renew_ceremony_step_lease"]);
});

test("un perfil no se comprueba contra el catálogo de otro servidor", () => {
  const worker = ToolProfiles.standard().byId(ProfileId.MADE_WORKER);
  assert.throws(() => worker.check(catalogWith(ServerName.KMP, [])), /made-worker.*kmp/);
});
```

`tests/unit/application/mappers/MadeCapabilitiesMapper.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MadeCapabilitiesMapper } from "../../../../src/application/mappers/MadeCapabilitiesMapper.ts";
import { DeclaredLimitId } from "../../../../src/domain/made/DeclaredLimitId.ts";

test("lee capabilities, declared_limits y host_activation", () => {
  const caps = new MadeCapabilitiesMapper().toDomain({
    schema_version: "1.0", server: { version: "0.8.0" }, tool_count: 104,
    capabilities: [{ id: "integrator" }], declared_limits: [{ id: "agent_roster_is_process_local" }],
    host_activation: { adapter: "none" },
  });
  assert.equal(caps.serverVersion.value, "0.8.0");
  assert.equal(caps.toolCount, 104);
  assert.deepEqual(caps.groups.map(String), ["integrator"]);
  assert.ok(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL));
  assert.equal(caps.activationAdapter, "none");
});

test("schema_version desconocido y host_activation nulo", () => {
  assert.throws(() => new MadeCapabilitiesMapper().toDomain({ schema_version: "2.0" }), /schema_version/);
  const caps = new MadeCapabilitiesMapper().toDomain({ schema_version: "1.0", server: { version: "0.8.0" }, host_activation: null });
  assert.equal(caps.activationAdapter, null);
});
```

`tests/unit/application/use-cases/VerifyServerProfiles.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { VerifyServerProfiles } from "../../../../src/application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { ProfileId } from "../../../../src/domain/contracts/ProfileId.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolDescriptor } from "../../../../src/domain/mcp/ToolDescriptor.ts";
import { ToolDescription } from "../../../../src/domain/mcp/ToolDescription.ts";
import { JsonSchema } from "../../../../src/domain/mcp/JsonSchema.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";

test("comprueba todos los perfiles del servidor del catálogo", () => {
  const profiles = ToolProfiles.standard();
  const names = profiles.byId(ProfileId.KMP_INTERACTIVE).required;
  const cat = ToolCatalog.of(ServerName.KMP, ServerIdentity.of("k", SemVer.of("0.24.0")), names.map((n) => ToolDescriptor.of(n, ToolDescription.of(n.value), JsonSchema.of({}))));
  const checks = new VerifyServerProfiles(profiles).execute(cat);
  assert.deepEqual(checks.map((c) => [c.profile.value, c.isSatisfied()]), [["kmp-interactive", true], ["kmp-projection", false]]);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar**

`src/domain/contracts/ProfileId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const KNOWN = ["kmp-interactive", "kmp-projection", "made-session", "made-worker"];

export class ProfileId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly KMP_INTERACTIVE = new ProfileId("kmp-interactive");
  static readonly KMP_PROJECTION = new ProfileId("kmp-projection");
  static readonly MADE_SESSION = new ProfileId("made-session");
  static readonly MADE_WORKER = new ProfileId("made-worker");
  static of(raw: string): ProfileId {
    if (!KNOWN.includes(raw)) throw DomainError.because(`unknown profile ${raw}`);
    return new ProfileId(raw);
  }
}
```

`src/domain/contracts/ProfileCheck.ts`:

```ts
import type { ToolName } from "../mcp/ToolName.ts";
import type { ProfileId } from "./ProfileId.ts";

export class ProfileCheck {
  readonly profile: ProfileId; readonly #missing: ToolName[];
  private constructor(p: ProfileId, m: ToolName[]) { this.profile = p; this.#missing = m; }
  static of(profile: ProfileId, missing: ToolName[]): ProfileCheck { return new ProfileCheck(profile, missing); }
  missing(): ToolName[] { return [...this.#missing]; }
  isSatisfied(): boolean { return this.#missing.length === 0; }
}
```

`src/domain/contracts/ToolProfile.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import type { ServerName } from "../mcp/ServerName.ts";
import type { ToolCatalog } from "../mcp/ToolCatalog.ts";
import type { ToolName } from "../mcp/ToolName.ts";
import { ProfileCheck } from "./ProfileCheck.ts";
import type { ProfileId } from "./ProfileId.ts";

export class ToolProfile {
  readonly id: ProfileId; readonly server: ServerName; readonly required: readonly ToolName[];
  private constructor(id: ProfileId, s: ServerName, r: ToolName[]) { this.id = id; this.server = s; this.required = r; }
  static of(id: ProfileId, server: ServerName, required: ToolName[]): ToolProfile { return new ToolProfile(id, server, required); }
  check(catalog: ToolCatalog): ProfileCheck {
    if (!catalog.server.equals(this.server)) throw DomainError.because(`profile ${this.id} cannot be checked against ${catalog.server}`);
    return ProfileCheck.of(this.id, this.required.filter((t) => !catalog.has(t)));
  }
}
```

`src/domain/contracts/ToolProfiles.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { ServerName } from "../mcp/ServerName.ts";
import { ToolName } from "../mcp/ToolName.ts";
import { ProfileId } from "./ProfileId.ts";
import { ToolProfile } from "./ToolProfile.ts";

const names = (xs: string[]) => xs.map((x) => ToolName.of(x));

export class ToolProfiles {
  readonly #profiles: ToolProfile[];
  private constructor(p: ToolProfile[]) { this.#profiles = p; }

  static standard(): ToolProfiles {
    return new ToolProfiles([
      ToolProfile.of(ProfileId.KMP_INTERACTIVE, ServerName.KMP, names(["kmp_guide", "kmp_wake", "kmp_ask", "kmp_time", "kmp_trace", "kmp_inspect", "kmp_relate", "kmp_write_memory", "kmp_relabel", "kmp_condense", "kmp_view_open", "kmp_view_get_state", "kmp_view_apply_intent"])),
      ToolProfile.of(ProfileId.KMP_PROJECTION, ServerName.KMP, names(["kmp_ingest", "kmp_curate", "kmp_relabel", "kmp_summaries_audit", "kmp_write_memory"])),
      ToolProfile.of(ProfileId.MADE_SESSION, ServerName.MADE, names(["made_discover_capabilities", "made_start_published_ceremony", "made_get_ceremony_instance", "made_bind_ceremony_integrator", "made_await_integrator_attention", "made_acknowledge_integrator_attention", "made_issue_authorization_grant", "made_revoke_authorization_grant", "made_approve_authorization_operation", "made_get_budget_report", "made_plan_ceremony_successor", "made_start_ceremony_successor", "made_inspect_ceremony_resume", "made_record_ceremony_host_handoff", "made_pull_ceremony_events"])),
      ToolProfile.of(ProfileId.MADE_WORKER, ServerName.MADE, names(["made_claim_ceremony_step", "made_complete_ceremony_step", "made_renew_ceremony_step_lease", "made_report_ceremony_agent_status", "made_pull_ceremony_agent_interventions", "made_acknowledge_ceremony_agent_intervention", "made_get_execution_receipt", "made_complete_execution_receipt", "made_adopt_execution_receipt", "made_inspect_execution_recovery", "made_assert_ceremony_reason"])),
    ]);
  }

  forServer(server: ServerName): ToolProfile[] { return this.#profiles.filter((p) => p.server.equals(server)); }
  byId(id: ProfileId): ToolProfile {
    const p = this.#profiles.find((x) => x.id.equals(id));
    if (!p) throw DomainError.because(`no profile ${id}`);
    return p;
  }
}
```

`src/domain/made/CapabilityGroupId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CapabilityGroupId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CapabilityGroupId {
    if (!/^[a-z][a-z0-9_.-]*$/.test(raw)) throw DomainError.because(`invalid capability group ${raw}`);
    return new CapabilityGroupId(raw);
  }
}
```

`src/domain/made/DeclaredLimitId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class DeclaredLimitId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly ROSTER_PROCESS_LOCAL = new DeclaredLimitId("agent_roster_is_process_local");
  static of(raw: string): DeclaredLimitId {
    if (!/^[a-z][a-z0-9_]*$/.test(raw)) throw DomainError.because(`invalid declared limit ${raw}`);
    return new DeclaredLimitId(raw);
  }
}
```

`src/domain/made/MadeCapabilities.ts`:

```ts
import type { SemVer } from "../distribution/SemVer.ts";
import type { CapabilityGroupId } from "./CapabilityGroupId.ts";
import type { DeclaredLimitId } from "./DeclaredLimitId.ts";

type Props = { serverVersion: SemVer; toolCount: number; groups: CapabilityGroupId[]; limits: DeclaredLimitId[]; activationAdapter: string | null };

export class MadeCapabilities {
  readonly serverVersion: SemVer; readonly toolCount: number; readonly groups: readonly CapabilityGroupId[];
  readonly limits: readonly DeclaredLimitId[]; readonly activationAdapter: string | null;
  private constructor(p: Props) { this.serverVersion = p.serverVersion; this.toolCount = p.toolCount; this.groups = p.groups; this.limits = p.limits; this.activationAdapter = p.activationAdapter; }
  static of(p: Props): MadeCapabilities { return new MadeCapabilities(p); }
  declares(limit: DeclaredLimitId): boolean { return this.limits.some((l) => l.equals(limit)); }
}
```

`src/application/dto/MadeCapabilitiesDto.ts`:

```ts
export type MadeCapabilitiesDto = {
  schema_version?: string; server?: { version?: string }; tool_count?: number;
  capabilities?: { id: string }[]; declared_limits?: { id: string }[]; host_activation?: { adapter: string } | null;
};
```

`src/application/mappers/MadeCapabilitiesMapper.ts`:

```ts
import { DomainError } from "../../domain/shared/DomainError.ts";
import { SemVer } from "../../domain/distribution/SemVer.ts";
import { CapabilityGroupId } from "../../domain/made/CapabilityGroupId.ts";
import { DeclaredLimitId } from "../../domain/made/DeclaredLimitId.ts";
import { MadeCapabilities } from "../../domain/made/MadeCapabilities.ts";
import type { MadeCapabilitiesDto } from "../dto/MadeCapabilitiesDto.ts";

export class MadeCapabilitiesMapper {
  toDomain(dto: MadeCapabilitiesDto): MadeCapabilities {
    if (dto.schema_version !== "1.0") throw DomainError.because(`made capabilities: unsupported schema_version ${dto.schema_version}`);
    return MadeCapabilities.of({
      serverVersion: SemVer.of(dto.server?.version ?? "0.0.0"),
      toolCount: dto.tool_count ?? 0,
      groups: (dto.capabilities ?? []).map((c) => CapabilityGroupId.of(c.id)),
      limits: (dto.declared_limits ?? []).map((l) => DeclaredLimitId.of(l.id)),
      activationAdapter: dto.host_activation?.adapter ?? null,
    });
  }
}
```

`src/application/use-cases/VerifyServerProfiles.ts`:

```ts
import type { ProfileCheck } from "../../domain/contracts/ProfileCheck.ts";
import type { ToolProfiles } from "../../domain/contracts/ToolProfiles.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";

export class VerifyServerProfiles {
  readonly #profiles: ToolProfiles;
  constructor(profiles: ToolProfiles) { this.#profiles = profiles; }
  execute(catalog: ToolCatalog): ProfileCheck[] { return this.#profiles.forServer(catalog.server).map((p) => p.check(catalog)); }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(contratos): perfiles de tools y capacidades de MADE en dominio"
```

---

### Task 7: Configuración de MADE y comandos de servidor

**Files:**
- Create:
  - dominio: `src/domain/made/{StorePath,PolicyId,TrustedHostId,CeremonyStoreId,CursorHmacKey,MadeConfiguration}.ts`, `src/domain/project/{ProjectRoot,ProjectId,Project}.ts`
  - puertos: `src/application/ports/{MadeConfigurationRepository,EntropySource,ServerCommandFactory}.ts`
  - caso de uso: `src/application/use-cases/EnsureMadeConfiguration.ts`
  - adaptadores: `src/adapters/outbound/fs/FsMadeConfigurationRepository.ts`, `src/adapters/outbound/crypto/NodeEntropySource.ts`, `src/adapters/outbound/process/{KmpServerCommandFactory,MadeServerCommandFactory}.ts`
- Test: `tests/unit/domain/made/configuration.test.ts`, `tests/unit/domain/project/project.test.ts`, `tests/unit/application/use-cases/EnsureMadeConfiguration.test.ts`, `tests/unit/adapters/outbound/fs/FsMadeConfigurationRepository.test.ts`, `tests/unit/adapters/outbound/process/ServerCommandFactories.test.ts`

**Interfaces:**
- Produces:
  - `StorePath.of(absolutePath)`, con `configDigest(): string` (16 hex del sha256 de la ruta)
  - `PolicyId.of`, `TrustedHostId.of`, `CeremonyStoreId.of`: sin espacios ni `=`
  - `CursorHmacKey.of(hex64)`: `toString()` devuelve `"[redacted]"` y `reveal()` devuelve el valor
  - `MadeConfiguration.of({...})`, `MadeConfiguration.generateFor(store: StorePath, entropy: Uint8Array)` y `entries(): [string, string][]` (el adaptador los escribe tal cual)
  - `ProjectRoot.of(absolutePath)`, `ProjectId.derive(root)` y `ProjectId.of(hex16)`; `Project.of(root)`
  - `interface MadeConfigurationRepository { load(store: StorePath): MadeConfiguration | null; create(store: StorePath, config: MadeConfiguration): void; locationOf(store: StorePath): string }`
  - `interface EntropySource { bytes(n: number): Uint8Array }`
  - `interface ServerCommandFactory { commandFor(project: Project): ServerCommandDto }`
  - `EnsureMadeConfiguration.execute(store): { configuration: MadeConfiguration; created: boolean; location: string }`
  - `FsMadeConfigurationRepository` con `constructor(env: Record<string, string | undefined>)`
  - `KmpServerCommandFactory` con `constructor(binary: string, env)`
  - `MadeServerCommandFactory` con `constructor(binary: string, store: StorePath, configuration: MadeConfiguration, env)`

- [ ] **Step 1: Tests que fallan**

`tests/unit/domain/made/configuration.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import { PolicyId } from "../../../../src/domain/made/PolicyId.ts";
import { CursorHmacKey } from "../../../../src/domain/made/CursorHmacKey.ts";
import { MadeConfiguration } from "../../../../src/domain/made/MadeConfiguration.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("StorePath exige ruta absoluta y deriva el digest de configuración del plugin", () => {
  const s = StorePath.of("/h/.local/state/underpass-made/ceremonies.sqlite3");
  assert.equal(s.configDigest(), createHash("sha256").update(s.value).digest("hex").slice(0, 16));
  assert.throws(() => StorePath.of("relative/x"), DomainError);
});

test("identidades sin espacios ni =; clave redactada", () => {
  assert.throws(() => PolicyId.of("a b"), DomainError);
  assert.throws(() => PolicyId.of("a=b"), DomainError);
  const key = CursorHmacKey.of("ab".repeat(32));
  assert.equal(String(key), "[redacted]");
  assert.equal(JSON.stringify({ key }), '{"key":"[redacted]"}');
  assert.equal(key.reveal(), "ab".repeat(32));
  assert.throws(() => CursorHmacKey.of("zz"), DomainError);
});

test("generateFor sigue la convención made-local-*-<digest>", () => {
  const s = StorePath.of("/x/ceremonies.sqlite3");
  const c = MadeConfiguration.generateFor(s, new Uint8Array(32).fill(1));
  const d = s.configDigest();
  assert.deepEqual(c.entries().map(([k, v]) => [k, k.endsWith("HMAC_KEY") ? v.length : v]), [
    ["MADE_AUTH_POLICY_ID", `made-local-policy-${d}`],
    ["MADE_AUTH_TRUSTED_HOST_ID", `made-local-host-${d}`],
    ["MADE_CEREMONY_STORE_ID", `made-local-store-${d}`],
    ["MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY", 64],
  ]);
  assert.throws(() => MadeConfiguration.generateFor(s, new Uint8Array(8)), /32 bytes/);
});
```

`tests/unit/domain/project/project.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("proyecto: raíz absoluta e id derivado", () => {
  const p = Project.of(ProjectRoot.of("/repo"));
  assert.equal(p.id.value, createHash("sha256").update("/repo").digest("hex").slice(0, 16));
  assert.ok(ProjectId.derive(ProjectRoot.of("/repo")).equals(p.id));
  assert.throws(() => ProjectRoot.of("repo"), DomainError);
  assert.throws(() => ProjectId.of("xyz"), DomainError);
});
```

`tests/unit/application/use-cases/EnsureMadeConfiguration.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EnsureMadeConfiguration } from "../../../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import type { MadeConfiguration } from "../../../../src/domain/made/MadeConfiguration.ts";

class MemoryRepo {
  stored: MadeConfiguration | null = null; creates = 0;
  load() { return this.stored; }
  create(_s: StorePath, c: MadeConfiguration) { this.stored = c; this.creates++; }
  locationOf() { return "/cfg/x.env"; }
}

test("crea una vez y reutiliza sin rotar", () => {
  const repo = new MemoryRepo();
  const uc = new EnsureMadeConfiguration(repo, { bytes: (n) => new Uint8Array(n).fill(7) });
  const store = StorePath.of("/s/ceremonies.sqlite3");
  const a = uc.execute(store);
  const b = uc.execute(store);
  assert.deepEqual([a.created, b.created, repo.creates], [true, false, 1]);
  assert.equal(b.configuration, a.configuration);
  assert.equal(a.location, "/cfg/x.env");
});
```

`tests/unit/adapters/outbound/fs/FsMadeConfigurationRepository.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsMadeConfigurationRepository } from "../../../../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const repo = new FsMadeConfigurationRepository({ HOME: home });
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  return { home, repo, store };
};

test("ubicación compatible con el plugin de MADE; crea 0600; relee igual", () => {
  const { home, repo, store } = setup();
  assert.equal(repo.locationOf(store), join(home, ".config/underpass-made/embedded", `${store.configDigest()}.env`));
  assert.equal(repo.load(store), null);
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3));
  repo.create(store, cfg);
  assert.equal(statSync(repo.locationOf(store)).mode & 0o777, 0o600);
  assert.deepEqual(repo.load(store)!.entries(), cfg.entries());
  assert.throws(() => repo.create(store, cfg), /EEXIST/);
});

test("rechaza permisos abiertos, symlink y claves de más", () => {
  const { home, repo, store } = setup();
  repo.create(store, MadeConfiguration.generateFor(store, new Uint8Array(32).fill(3)));
  const loc = repo.locationOf(store);
  chmodSync(loc, 0o644);
  assert.throws(() => repo.load(store), /mode 644/);
  chmodSync(loc, 0o600);
  writeFileSync(loc, readFileSync(loc, "utf8") + "EXTRA=1\n");
  assert.throws(() => repo.load(store), /exactly four keys/);
  const target = join(home, "real.env"); writeFileSync(target, ""); rmSync(loc); symlinkSync(target, loc);
  assert.throws(() => repo.load(store), /symlink/);
});

test("MADE_SETUP_CONFIG_ROOT y XDG_CONFIG_HOME se respetan", () => {
  const store = StorePath.of("/s/c.sqlite3");
  assert.equal(new FsMadeConfigurationRepository({ HOME: "/h", MADE_SETUP_CONFIG_ROOT: "/r" }).locationOf(store), `/r/${store.configDigest()}.env`);
  assert.equal(new FsMadeConfigurationRepository({ HOME: "/h", XDG_CONFIG_HOME: "/x" }).locationOf(store), `/x/underpass-made/embedded/${store.configDigest()}.env`);
});
```

`tests/unit/adapters/outbound/process/ServerCommandFactories.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { KmpServerCommandFactory } from "../../../../../src/adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeServerCommandFactory } from "../../../../../src/adapters/outbound/process/MadeServerCommandFactory.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";
import { Project } from "../../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../../src/domain/project/ProjectRoot.ts";

const project = Project.of(ProjectRoot.of("/repo"));

test("KMP: embebido y cwd en la raíz del proyecto para resolver .kernel/", () => {
  const c = new KmpServerCommandFactory("/bin/kmp-mcp", { PATH: "/usr/bin" }).commandFor(project);
  assert.deepEqual([c.command, c.args, c.cwd, c.env.KMP_MCP_BACKEND, c.env.PATH], ["/bin/kmp-mcp", [], "/repo", "embedded", "/usr/bin"]);
});

test("MADE: store, backend y las cuatro claves por entorno, nunca por argumentos", () => {
  const store = StorePath.of("/s/ceremonies.sqlite3");
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(9));
  const c = new MadeServerCommandFactory("/bin/made-mcp", store, cfg, {}).commandFor(project);
  assert.deepEqual(c.args, []);
  assert.equal(c.env.MADE_MCP_BACKEND, "embedded");
  assert.equal(c.env.MADE_MCP_STORE_PATH, "/s/ceremonies.sqlite3");
  assert.equal(c.env.MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY?.length, 64);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar el dominio**

`src/domain/made/StorePath.ts`:

```ts
import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class StorePath extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): StorePath {
    if (!raw.startsWith("/")) throw DomainError.because(`store path must be absolute: ${raw}`);
    return new StorePath(raw);
  }
  configDigest(): string { return createHash("sha256").update(this.value).digest("hex").slice(0, 16); }
}
```

`src/domain/made/PolicyId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class PolicyId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): PolicyId {
    if (!raw || /[\s=]/.test(raw)) throw DomainError.because("policy id must be non-empty without whitespace or '='");
    return new PolicyId(raw);
  }
}
```

`src/domain/made/TrustedHostId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class TrustedHostId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): TrustedHostId {
    if (!raw || /[\s=]/.test(raw)) throw DomainError.because("trusted host id must be non-empty without whitespace or '='");
    return new TrustedHostId(raw);
  }
}
```

`src/domain/made/CeremonyStoreId.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CeremonyStoreId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CeremonyStoreId {
    if (!raw || /[\s=]/.test(raw)) throw DomainError.because("ceremony store id must be non-empty without whitespace or '='");
    return new CeremonyStoreId(raw);
  }
}
```

`src/domain/made/CursorHmacKey.ts`. No extiende `ValueObject` para que `value` no filtre la clave:

```ts
import { DomainError } from "../shared/DomainError.ts";

export class CursorHmacKey {
  readonly #hex: string;
  private constructor(hex: string) { this.#hex = hex; }
  static of(raw: string): CursorHmacKey {
    if (!/^[0-9a-f]{64}$/.test(raw)) throw DomainError.because("cursor HMAC key must be 64 lowercase hex characters");
    return new CursorHmacKey(raw);
  }
  reveal(): string { return this.#hex; }
  equals(o: CursorHmacKey): boolean { return o.reveal() === this.#hex; }
  toString(): string { return "[redacted]"; }
  toJSON(): string { return "[redacted]"; }
}
```

`src/domain/made/MadeConfiguration.ts`:

```ts
import { DomainError } from "../shared/DomainError.ts";
import { CeremonyStoreId } from "./CeremonyStoreId.ts";
import { CursorHmacKey } from "./CursorHmacKey.ts";
import { PolicyId } from "./PolicyId.ts";
import type { StorePath } from "./StorePath.ts";
import { TrustedHostId } from "./TrustedHostId.ts";

type Props = { policy: PolicyId; trustedHost: TrustedHostId; store: CeremonyStoreId; cursorKey: CursorHmacKey };

export class MadeConfiguration {
  readonly policy: PolicyId; readonly trustedHost: TrustedHostId; readonly store: CeremonyStoreId; readonly cursorKey: CursorHmacKey;
  private constructor(p: Props) { this.policy = p.policy; this.trustedHost = p.trustedHost; this.store = p.store; this.cursorKey = p.cursorKey; }

  static of(p: Props): MadeConfiguration { return new MadeConfiguration(p); }

  static generateFor(store: StorePath, entropy: Uint8Array): MadeConfiguration {
    if (entropy.length !== 32) throw DomainError.because("cursor key needs exactly 32 bytes of entropy");
    const d = store.configDigest();
    return new MadeConfiguration({
      policy: PolicyId.of(`made-local-policy-${d}`),
      trustedHost: TrustedHostId.of(`made-local-host-${d}`),
      store: CeremonyStoreId.of(`made-local-store-${d}`),
      cursorKey: CursorHmacKey.of([...entropy].map((b) => b.toString(16).padStart(2, "0")).join("")),
    });
  }

  entries(): [string, string][] {
    return [
      ["MADE_AUTH_POLICY_ID", this.policy.value],
      ["MADE_AUTH_TRUSTED_HOST_ID", this.trustedHost.value],
      ["MADE_CEREMONY_STORE_ID", this.store.value],
      ["MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY", this.cursorKey.reveal()],
    ];
  }
}
```

`src/domain/project/ProjectRoot.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ProjectRoot extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ProjectRoot {
    if (!raw.startsWith("/")) throw DomainError.because(`project root must be absolute: ${raw}`);
    return new ProjectRoot(raw.replace(/\/+$/, "") || "/");
  }
}
```

`src/domain/project/ProjectId.ts`:

```ts
import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { ProjectRoot } from "./ProjectRoot.ts";

export class ProjectId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ProjectId {
    if (!/^[0-9a-f]{16}$/.test(raw)) throw DomainError.because("project id must be 16 hex characters");
    return new ProjectId(raw);
  }
  static derive(root: ProjectRoot): ProjectId { return new ProjectId(createHash("sha256").update(root.value).digest("hex").slice(0, 16)); }
}
```

`src/domain/project/Project.ts`:

```ts
import { ProjectId } from "./ProjectId.ts";
import type { ProjectRoot } from "./ProjectRoot.ts";

export class Project {
  readonly root: ProjectRoot; readonly id: ProjectId;
  private constructor(root: ProjectRoot) { this.root = root; this.id = ProjectId.derive(root); }
  static of(root: ProjectRoot): Project { return new Project(root); }
}
```

- [ ] **Step 4: Implementar aplicación y adaptadores**

`src/application/ports/MadeConfigurationRepository.ts`:

```ts
import type { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";

export interface MadeConfigurationRepository {
  load(store: StorePath): MadeConfiguration | null;
  create(store: StorePath, configuration: MadeConfiguration): void;
  locationOf(store: StorePath): string;
}
```

`src/application/ports/EntropySource.ts`:

```ts
export interface EntropySource { bytes(count: number): Uint8Array; }
```

`src/application/ports/ServerCommandFactory.ts`:

```ts
import type { Project } from "../../domain/project/Project.ts";
import type { ServerCommandDto } from "../dto/ServerCommandDto.ts";

export interface ServerCommandFactory { commandFor(project: Project): ServerCommandDto; }
```

`src/application/use-cases/EnsureMadeConfiguration.ts`:

```ts
import { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import type { EntropySource } from "../ports/EntropySource.ts";
import type { MadeConfigurationRepository } from "../ports/MadeConfigurationRepository.ts";

export class EnsureMadeConfiguration {
  readonly #repo: MadeConfigurationRepository; readonly #entropy: EntropySource;
  constructor(repo: MadeConfigurationRepository, entropy: EntropySource) { this.#repo = repo; this.#entropy = entropy; }
  execute(store: StorePath): { configuration: MadeConfiguration; created: boolean; location: string } {
    const location = this.#repo.locationOf(store);
    const existing = this.#repo.load(store);
    if (existing) return { configuration: existing, created: false, location };
    const configuration = MadeConfiguration.generateFor(store, this.#entropy.bytes(32));
    this.#repo.create(store, configuration);
    return { configuration, created: true, location };
  }
}
```

`src/adapters/outbound/crypto/NodeEntropySource.ts`:

```ts
import { randomBytes } from "node:crypto";
import type { EntropySource } from "../../../application/ports/EntropySource.ts";

export class NodeEntropySource implements EntropySource {
  bytes(count: number): Uint8Array { return new Uint8Array(randomBytes(count)); }
}
```

`src/adapters/outbound/fs/FsMadeConfigurationRepository.ts`:

```ts
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MadeConfigurationRepository } from "../../../application/ports/MadeConfigurationRepository.ts";
import { CeremonyStoreId } from "../../../domain/made/CeremonyStoreId.ts";
import { CursorHmacKey } from "../../../domain/made/CursorHmacKey.ts";
import { MadeConfiguration } from "../../../domain/made/MadeConfiguration.ts";
import { PolicyId } from "../../../domain/made/PolicyId.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";
import { TrustedHostId } from "../../../domain/made/TrustedHostId.ts";

const KEYS = ["MADE_AUTH_POLICY_ID", "MADE_AUTH_TRUSTED_HOST_ID", "MADE_CEREMONY_STORE_ID", "MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY"];

export class FsMadeConfigurationRepository implements MadeConfigurationRepository {
  readonly #env: Record<string, string | undefined>;
  constructor(env: Record<string, string | undefined>) { this.#env = env; }

  locationOf(store: StorePath): string {
    const root = this.#env.MADE_SETUP_CONFIG_ROOT ?? join(this.#env.XDG_CONFIG_HOME ?? join(this.#env.HOME ?? "", ".config"), "underpass-made", "embedded");
    return join(root, `${store.configDigest()}.env`);
  }

  load(store: StorePath): MadeConfiguration | null {
    const path = this.locationOf(store);
    if (!existsSync(path) && !this.#isDanglingLink(path)) return null;
    const st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error(`made config ${path} must not be a symlink`);
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error(`made config ${path} must be owned by the current user`);
    const mode = st.mode & 0o777;
    if (mode !== 0o600 && mode !== 0o400) throw new Error(`made config ${path} has mode ${mode.toString(8)}; expected 600 or 400`);
    const entries = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)] as [string, string]; });
    const keys = entries.map(([k]) => k);
    if (keys.length !== 4 || KEYS.some((k) => !keys.includes(k))) throw new Error(`made config ${path} must contain exactly four keys`);
    const v = Object.fromEntries(entries);
    return MadeConfiguration.of({ policy: PolicyId.of(v.MADE_AUTH_POLICY_ID), trustedHost: TrustedHostId.of(v.MADE_AUTH_TRUSTED_HOST_ID), store: CeremonyStoreId.of(v.MADE_CEREMONY_STORE_ID), cursorKey: CursorHmacKey.of(v.MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY) });
  }

  create(store: StorePath, configuration: MadeConfiguration): void {
    const path = this.locationOf(store);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, configuration.entries().map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
  }

  #isDanglingLink(path: string): boolean { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } }
}
```

`src/adapters/outbound/process/KmpServerCommandFactory.ts`:

```ts
import type { ServerCommandFactory } from "../../../application/ports/ServerCommandFactory.ts";
import type { ServerCommandDto } from "../../../application/dto/ServerCommandDto.ts";
import type { Project } from "../../../domain/project/Project.ts";

export class KmpServerCommandFactory implements ServerCommandFactory {
  readonly #binary: string; readonly #env: Record<string, string | undefined>;
  constructor(binary: string, env: Record<string, string | undefined>) { this.#binary = binary; this.#env = env; }
  commandFor(project: Project): ServerCommandDto {
    return { command: this.#binary, args: [], cwd: project.root.value, env: { ...this.#env, KMP_MCP_BACKEND: this.#env.KMP_MCP_BACKEND ?? "embedded" } };
  }
}
```

`src/adapters/outbound/process/MadeServerCommandFactory.ts`:

```ts
import type { ServerCommandFactory } from "../../../application/ports/ServerCommandFactory.ts";
import type { ServerCommandDto } from "../../../application/dto/ServerCommandDto.ts";
import type { MadeConfiguration } from "../../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";
import type { Project } from "../../../domain/project/Project.ts";

export class MadeServerCommandFactory implements ServerCommandFactory {
  readonly #binary: string; readonly #store: StorePath; readonly #config: MadeConfiguration; readonly #env: Record<string, string | undefined>;
  constructor(binary: string, store: StorePath, config: MadeConfiguration, env: Record<string, string | undefined>) {
    this.#binary = binary; this.#store = store; this.#config = config; this.#env = env;
  }
  commandFor(project: Project): ServerCommandDto {
    return { command: this.#binary, args: [], cwd: project.root.value,
      env: { ...this.#env, ...Object.fromEntries(this.#config.entries()), MADE_MCP_BACKEND: "embedded", MADE_MCP_STORE_PATH: this.#store.value } };
  }
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat(made): configuración privada compartida con el plugin, sin rotación y con clave redactada"
```

---

### Task 8: Pruebas de contrato P0 contra los binarios reales

**Files:**
- Create: `tests/contract/support.ts`, `tests/contract/kmp.contract.test.ts`, `tests/contract/made.contract.test.ts`, `docs/contracts/p0-findings.md`

**Interfaces:**
- Consumes: `StdioMcpConnector` (Task 5); `VerifyServerProfiles`, `ToolProfiles`, `MadeCapabilitiesMapper` (Task 6); `EnsureMadeConfiguration`, `FsMadeConfigurationRepository`, `NodeEntropySource`, las factorías de comandos, `StorePath`, `Project` (Task 7); `InstallPinnedBinaries` con sus adaptadores (Task 2)
- Produces: `docs/contracts/p0-findings.md` con los valores medidos

- [ ] **Step 1: Instalar los binarios fijados**

```bash
node -e '
const { JsonPinSetSource } = await import("./src/adapters/outbound/fs/JsonPinSetSource.ts");
const { InstallPinnedBinaries } = await import("./src/application/use-cases/InstallPinnedBinaries.ts");
const { Target } = await import("./src/domain/distribution/Target.ts");
const { GithubReleaseDownloader } = await import("./src/adapters/outbound/github/GithubReleaseDownloader.ts");
const { NodeFileDigester } = await import("./src/adapters/outbound/fs/NodeFileDigester.ts");
const { FsBinaryInstallation } = await import("./src/adapters/outbound/fs/FsBinaryInstallation.ts");
const uc = new InstallPinnedBinaries(new JsonPinSetSource("pins.json").load(), Target.detect(process.platform, process.arch),
  new GithubReleaseDownloader(), new NodeFileDigester(), new FsBinaryInstallation(process.env.HOME + "/.local/share/underpass-pi/bin"));
for (const r of await uc.execute()) console.log(r.name.value, r.action, r.path);' --input-type=module
```

Expected: `kmp-mcp installed .../kmp-mcp-0.24.0` y `made-mcp installed .../made-mcp-0.8.0`, sin `sha256 mismatch`.

- [ ] **Step 2: Soporte** `tests/contract/support.ts`

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { StdioMcpConnector } from "../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { KmpServerCommandFactory } from "../../src/adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeServerCommandFactory } from "../../src/adapters/outbound/process/MadeServerCommandFactory.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { NodeEntropySource } from "../../src/adapters/outbound/crypto/NodeEntropySource.ts";
import { EnsureMadeConfiguration } from "../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { StorePath } from "../../src/domain/made/StorePath.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import { Project } from "../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../src/domain/project/ProjectRoot.ts";

export const KMP_BIN = process.env.UNDERPASS_KMP_MCP_BIN;
export const MADE_BIN = process.env.UNDERPASS_MADE_MCP_BIN;
const tmpProject = () => Project.of(ProjectRoot.of(realpathSync(mkdtempSync(join(tmpdir(), "proj-")))));

export async function openKmp() {
  const env = { ...process.env, KMP_MCP_DATA_DIR: mkdtempSync(join(tmpdir(), "kmp-store-")) };
  return new StdioMcpConnector(60_000).open(ServerName.KMP, new KmpServerCommandFactory(KMP_BIN!, env).commandFor(tmpProject()));
}

export async function openMade() {
  const home = mkdtempSync(join(tmpdir(), "made-home-"));
  const env = { ...process.env, HOME: home };
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  mkdirSync(dirname(store.value), { recursive: true });
  const { configuration } = new EnsureMadeConfiguration(new FsMadeConfigurationRepository(env), new NodeEntropySource()).execute(store);
  execFileSync(MADE_BIN!, ["bootstrap-authorization", store.value, "--policy-id", configuration.policy.value, "--trusted-host-id", configuration.trustedHost.value]);
  return new StdioMcpConnector(60_000).open(ServerName.MADE, new MadeServerCommandFactory(MADE_BIN!, store, configuration, env).commandFor(tmpProject()));
}
```

- [ ] **Step 3: Contratos**

`tests/contract/kmp.contract.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { KMP_BIN, openKmp } from "./support.ts";
import { VerifyServerProfiles } from "../../src/application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../../src/domain/contracts/ToolProfiles.ts";
import { ToolName } from "../../src/domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../src/domain/mcp/ToolRefusal.ts";

const skip = !KMP_BIN && "UNDERPASS_KMP_MCP_BIN not set";

test("kmp-mcp 0.24.0: handshake y perfiles", { skip }, async () => {
  const c = await openKmp();
  try {
    assert.equal(c.protocol.value, "2024-11-05");
    assert.equal(c.identity.name, "underpass-kmp-mcp");
    assert.equal(c.identity.version.value, "0.24.0");
    const cat = await c.catalog();
    for (const check of new VerifyServerProfiles(ToolProfiles.standard()).execute(cat)) assert.deepEqual(check.missing().map(String), [], String(check.profile));
    console.log(`P0 kmp tools=${cat.names().length} fingerprint=${cat.fingerprint()}`);
  } finally { await c.close(); }
});

test("kmp-mcp: argumentos inválidos son negativa de negocio, no error RPC", { skip }, async () => {
  const c = await openKmp();
  try { assert.ok((await c.call(ToolName.of("kmp_inspect"), {})) instanceof ToolRefusal); }
  finally { await c.close(); }
});
```

`tests/contract/made.contract.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MADE_BIN, openMade } from "./support.ts";
import { VerifyServerProfiles } from "../../src/application/use-cases/VerifyServerProfiles.ts";
import { MadeCapabilitiesMapper } from "../../src/application/mappers/MadeCapabilitiesMapper.ts";
import { ToolProfiles } from "../../src/domain/contracts/ToolProfiles.ts";
import { DeclaredLimitId } from "../../src/domain/made/DeclaredLimitId.ts";
import { ToolName } from "../../src/domain/mcp/ToolName.ts";
import { ToolSuccess } from "../../src/domain/mcp/ToolSuccess.ts";

const skip = !MADE_BIN && "UNDERPASS_MADE_MCP_BIN not set";

test("made-mcp 0.8.0: handshake, perfiles y capacidades", { skip }, async () => {
  const c = await openMade();
  try {
    assert.equal(c.protocol.value, "2024-11-05");
    const cat = await c.catalog();
    for (const check of new VerifyServerProfiles(ToolProfiles.standard()).execute(cat)) assert.deepEqual(check.missing().map(String), [], String(check.profile));
    const r = await c.call(ToolName.of("made_discover_capabilities"), {});
    assert.ok(r instanceof ToolSuccess);
    const caps = new MadeCapabilitiesMapper().toDomain(r.structured as never);
    assert.equal(caps.serverVersion.value, "0.8.0");
    assert.ok(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL));
    console.log(`P0 made tools=${cat.names().length} fingerprint=${cat.fingerprint()} groups=${caps.groups.join(",")} limits=${caps.limits.join(",")}`);
  } finally { await c.close(); }
});

test("made-mcp: una espera acotada retrasa la siguiente llamada en la misma conexión", { skip }, async () => {
  const c = await openMade();
  try {
    const t0 = performance.now();
    const slow = c.call(ToolName.of("made_pull_ceremony_events"), { consumer_id: "p0-probe", max_events: 1, wait_timeout_ms: 2000 });
    const fast = c.call(ToolName.of("made_get_status"), {}).then(() => performance.now() - t0);
    const [, ms] = await Promise.all([slow, fast]);
    console.log(`P0 made head-of-line: made_get_status answered after ${Math.round(ms)}ms behind a 2000ms wait`);
  } finally { await c.close(); }
});
```

- [ ] **Step 4: Ejecutar contra los binarios**

```bash
UNDERPASS_KMP_MCP_BIN=$HOME/.local/share/underpass-pi/bin/kmp-mcp-0.24.0 \
UNDERPASS_MADE_MCP_BIN=$HOME/.local/share/underpass-pi/bin/made-mcp-0.8.0 \
npm run test:contract 2>&1 | tee /tmp/p0.log
```

Expected: PASS (4) con las líneas `P0 …`. Si `made_pull_ceremony_events` rechaza los argumentos (`isError` o `-32602`), se lee su `inputSchema` en el catálogo, se ajusta la llamada y se repite: lo que se mide es el bloqueo en cabeza de cola, no ese verbo. Sin las variables de entorno: SKIP (4).

- [ ] **Step 5: Registrar los hallazgos** en `docs/contracts/p0-findings.md`, con los valores reales de `/tmp/p0.log` y sin marcadores:

```markdown
# P0 — Hallazgos de contrato (AAAA-MM-DD)

| Servidor | Versión | protocolVersion | Tools | Huella |
|---|---|---|---|---|
| kmp-mcp | 0.24.0 | 2024-11-05 | … | … |
| made-mcp | 0.8.0 | 2024-11-05 | … | … |

- Grupos de MADE: … Límites declarados: …
- Cabeza de cola: `made_get_status` respondió a los … ms detrás de una espera de 2000 ms.
  **Regla para S3:** `made_await_integrator_attention` con `wait_timeout_ms` ≤ 1000 en la conexión propietaria y planificador justo; nunca long-poll de 30 s.
- Sin `ping` ni `notifications/cancelled`: un timeout del cliente deja el resultado desconocido y lleva a reconciliación.
```

- [ ] **Step 6: Commit**

```bash
git add tests/contract docs/contracts/p0-findings.md
git commit -m "test(p0): contratos reales de handshake, perfiles, capacidades y cabeza de cola"
```

---

### Task 9: Host por proyecto — puertos, lock e IPC

**Files:**
- Create:
  - puertos: `src/application/ports/{ProjectLocator,OwnerLock,OwnerLockAcquisition,HostGateway,HostLauncher}.ts`
  - DTOs: `src/application/dto/{HostRequestDto,HostResponseDto}.ts`
  - adaptadores: `src/adapters/outbound/git/GitProjectLocator.ts`, `src/adapters/outbound/fs/FsOwnerLock.ts`, `src/adapters/inbound/ipc/UnixSocketHostServer.ts`, `src/adapters/outbound/ipc/{UnixSocketHostGateway,HostCallError}.ts`
  - composición: `src/composition/StatePaths.ts`
- Test: `tests/unit/adapters/outbound/git/GitProjectLocator.test.ts`, `tests/unit/adapters/outbound/fs/FsOwnerLock.test.ts`, `tests/unit/adapters/ipc/UnixSocket.test.ts`, `tests/unit/composition/StatePaths.test.ts`

**Interfaces:**
- Consumes: `Project`, `ProjectRoot` (Task 7); `CatalogDto`, `ToolCallResultDto` (Task 4)
- Produces:
  - `interface ProjectLocator { locate(cwd: string): Project }`
  - `type OwnerLockAcquisition = { owned: true; release(): void } | { owned: false; ownerPid: number }`
  - `interface OwnerLock { acquire(): OwnerLockAcquisition }`
  - `type HostRequestDto = { id: number; method: "call"; server: string; tool: string; args: Record<string, unknown> } | { id: number; method: "catalog"; server: string } | { id: number; method: "health" }`
  - `type HostResponseDto = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { kind: "refused" | "rpc" | "transport" | "denied" | "invalid"; message: string; code?: string | number } }`
  - `interface HostGateway`:
    - `catalog(server: ServerName): Promise<ToolCatalog>`
    - `call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto>`, que lanza `HostCallError` si la llamada no se hace
    - `health(): Promise<{ project: string; started: string[] }>`
    - `close(): void`
  - `interface HostLauncher { launch(project: Project): void }`
  - `class HostCallError extends Error` con `readonly kind` y `readonly code?`
  - `UnixSocketHostServer.start(socketPath: string, handle: (req: HostRequestDto) => Promise<HostResponseDto>): Promise<UnixSocketHostServer>`, con `clients(): number` y `close(): Promise<void>`. Sólo admite `call | catalog | health`; cualquier otro método → `denied`.
  - `UnixSocketHostGateway.connect(socketPath: string, retries = 0, delayMs = 100): Promise<UnixSocketHostGateway>`
  - `StatePaths` con `constructor(env)`, `root(): string`, `projectDir(p: Project): string`, `socketOf(p): string`, `binDir(): string`, `fingerprintsFile(): string`

- [ ] **Step 1: Tests que fallan**

`tests/unit/adapters/outbound/git/GitProjectLocator.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitProjectLocator } from "../../../../../src/adapters/outbound/git/GitProjectLocator.ts";

test("un subdirectorio resuelve al mismo proyecto que la raíz del repo", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-")));
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, "a/b"), { recursive: true });
  const loc = new GitProjectLocator();
  assert.equal(loc.locate(root).root.value, root);
  assert.ok(loc.locate(join(root, "a/b")).id.equals(loc.locate(root).id));
});

test("fuera de un repo, el proyecto es el propio directorio", () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "norepo-")));
  assert.equal(new GitProjectLocator().locate(d).root.value, d);
});
```

`tests/unit/adapters/outbound/fs/FsOwnerLock.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsOwnerLock } from "../../../../../src/adapters/outbound/fs/FsOwnerLock.ts";

test("propietario único; el segundo ve el pid; liberar permite retomarlo", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  const a = new FsOwnerLock(dir).acquire();
  assert.equal(a.owned, true);
  assert.deepEqual(new FsOwnerLock(dir).acquire(), { owned: false, ownerPid: process.pid });
  if (a.owned) a.release();
  assert.equal(new FsOwnerLock(dir).acquire().owned, true);
});

test("un lock de un proceso muerto o corrupto se recupera", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  writeFileSync(join(dir, "host.lock"), JSON.stringify({ pid: 2 ** 22 + 12345 }));
  assert.equal(new FsOwnerLock(dir).acquire().owned, true);
  const dir2 = mkdtempSync(join(tmpdir(), "lock-"));
  writeFileSync(join(dir2, "host.lock"), "garbage");
  assert.equal(new FsOwnerLock(dir2).acquire().owned, true);
});
```

`tests/unit/adapters/ipc/UnixSocket.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnixSocketHostServer } from "../../../../src/adapters/inbound/ipc/UnixSocketHostServer.ts";
import { UnixSocketHostGateway } from "../../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { HostCallError } from "../../../../src/adapters/outbound/ipc/HostCallError.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";

const sock = () => join(mkdtempSync(join(tmpdir(), "ipc-")), "host.sock");

test("socket 0600, catálogo, llamada, health y errores tipados", async () => {
  const path = sock();
  const server = await UnixSocketHostServer.start(path, async (req) => {
    if (req.method === "health") return { id: req.id, ok: true, result: { project: "/p", started: [] } };
    if (req.method === "catalog") return { id: req.id, ok: true, result: { server: "kmp", serverName: "k", serverVersion: "1.0.0", fingerprint: "a".repeat(64), tools: [{ name: "kmp_ask", inputSchema: {} }] } };
    if (req.tool === "kmp_bad") return { id: req.id, ok: false, error: { kind: "refused", code: "not_found", message: "nope" } };
    return { id: req.id, ok: true, result: { structured: req.args, text: "ok" } };
  });
  try {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const gw = await UnixSocketHostGateway.connect(path);
    assert.deepEqual(await gw.health(), { project: "/p", started: [] });
    assert.deepEqual((await gw.catalog(ServerName.KMP)).names().map(String), ["kmp_ask"]);
    assert.deepEqual(await gw.call(ServerName.KMP, ToolName.of("kmp_ask"), { q: 1 }), { structured: { q: 1 }, text: "ok" });
    await assert.rejects(gw.call(ServerName.KMP, ToolName.of("kmp_bad"), {}), (e) => e instanceof HostCallError && e.kind === "refused" && e.code === "not_found");
    assert.equal(server.clients(), 1);
    gw.close();
  } finally { await server.close(); }
});

test("métodos no permitidos y JSON inválido nunca llegan al handler", async () => {
  const path = sock();
  let called = false;
  const server = await UnixSocketHostServer.start(path, async (req) => { called = true; return { id: req.id, ok: true, result: null }; });
  try {
    const gw = await UnixSocketHostGateway.connect(path);
    await assert.rejects(gw.raw({ method: "shutdown" }), (e) => e instanceof HostCallError && e.kind === "denied");
    assert.equal(called, false);
    gw.close();
  } finally { await server.close(); }
});

test("connect con reintentos falla si nadie escucha; el cierre del host rechaza lo pendiente", async () => {
  await assert.rejects(UnixSocketHostGateway.connect(sock(), 2, 10));
  const path = sock();
  const server = await UnixSocketHostServer.start(path, () => new Promise(() => {}));
  const gw = await UnixSocketHostGateway.connect(path);
  const pending = gw.health();
  await server.close();
  await assert.rejects(pending, (e) => e instanceof HostCallError && e.kind === "transport");
});
```

`tests/unit/composition/StatePaths.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";

test("rutas de estado bajo XDG y fuera del proyecto", () => {
  const p = Project.of(ProjectRoot.of("/repo"));
  const s = new StatePaths({ HOME: "/h" });
  assert.equal(s.root(), "/h/.local/state/underpass-pi");
  assert.equal(s.socketOf(p), `/h/.local/state/underpass-pi/projects/${p.id}/host.sock`);
  assert.equal(s.binDir(), "/h/.local/share/underpass-pi/bin");
  assert.equal(new StatePaths({ HOME: "/h", XDG_STATE_HOME: "/s", XDG_DATA_HOME: "/d" }).fingerprintsFile(), "/s/underpass-pi/fingerprints.json");
  assert.equal(new StatePaths({ HOME: "/h", XDG_DATA_HOME: "/d" }).binDir(), "/d/underpass-pi/bin");
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar**

`src/application/ports/ProjectLocator.ts`:

```ts
import type { Project } from "../../domain/project/Project.ts";

export interface ProjectLocator { locate(cwd: string): Project; }
```

`src/application/ports/OwnerLockAcquisition.ts`:

```ts
export type OwnerLockAcquisition = { owned: true; release(): void } | { owned: false; ownerPid: number };
```

`src/application/ports/OwnerLock.ts`:

```ts
import type { OwnerLockAcquisition } from "./OwnerLockAcquisition.ts";

export interface OwnerLock { acquire(): OwnerLockAcquisition; }
```

`src/application/dto/HostRequestDto.ts`:

```ts
export type HostRequestDto =
  | { id: number; method: "call"; server: string; tool: string; args: Record<string, unknown> }
  | { id: number; method: "catalog"; server: string }
  | { id: number; method: "health" };
```

`src/application/dto/HostResponseDto.ts`:

```ts
export type HostResponseDto =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { kind: "refused" | "rpc" | "transport" | "denied" | "invalid"; message: string; code?: string | number } };
```

`src/application/ports/HostGateway.ts`:

```ts
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolCallResultDto } from "../dto/ToolCallResultDto.ts";

export interface HostGateway {
  catalog(server: ServerName): Promise<ToolCatalog>;
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto>;
  health(): Promise<{ project: string; started: string[] }>;
  close(): void;
}
```

`src/application/ports/HostLauncher.ts`:

```ts
import type { Project } from "../../domain/project/Project.ts";

export interface HostLauncher { launch(project: Project): void; }
```

`src/adapters/outbound/git/GitProjectLocator.ts`:

```ts
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { ProjectLocator } from "../../../application/ports/ProjectLocator.ts";
import { Project } from "../../../domain/project/Project.ts";
import { ProjectRoot } from "../../../domain/project/ProjectRoot.ts";

export class GitProjectLocator implements ProjectLocator {
  locate(cwd: string): Project {
    let root = cwd;
    try { root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { /* no es un repo: el directorio es el proyecto */ }
    return Project.of(ProjectRoot.of(realpathSync(root)));
  }
}
```

`src/adapters/outbound/fs/FsOwnerLock.ts`:

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OwnerLock } from "../../../application/ports/OwnerLock.ts";
import type { OwnerLockAcquisition } from "../../../application/ports/OwnerLockAcquisition.ts";

export class FsOwnerLock implements OwnerLock {
  readonly #file: string;
  constructor(dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); this.#file = join(dir, "host.lock"); }

  acquire(): OwnerLockAcquisition {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(this.#file, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
        return { owned: true, release: () => rmSync(this.#file, { force: true }) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const pid = this.#ownerPid();
        if (pid > 0 && this.#alive(pid)) return { owned: false, ownerPid: pid };
        rmSync(this.#file, { force: true });
      }
    }
    throw new Error(`could not acquire ${this.#file}`);
  }

  #ownerPid(): number { try { return Number(JSON.parse(readFileSync(this.#file, "utf8")).pid) || -1; } catch { return -1; } }
  #alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } }
}
```

`src/adapters/inbound/ipc/UnixSocketHostServer.ts`:

```ts
import { chmodSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type { HostRequestDto } from "../../../application/dto/HostRequestDto.ts";
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";

const ALLOWED = new Set(["call", "catalog", "health"]);
type Handler = (req: HostRequestDto) => Promise<HostResponseDto>;

export class UnixSocketHostServer {
  readonly #server: Server; readonly #path: string; readonly #sockets = new Set<Socket>();

  private constructor(server: Server, path: string) { this.#server = server; this.#path = path; }

  static async start(path: string, handle: Handler): Promise<UnixSocketHostServer> {
    rmSync(path, { force: true });
    let self: UnixSocketHostServer;
    const server = createServer((sock) => self.#accept(sock, handle));
    self = new UnixSocketHostServer(server, path);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => resolve()); });
    chmodSync(path, 0o600);
    return self;
  }

  clients(): number { return this.#sockets.size; }

  close(): Promise<void> {
    return new Promise((resolve) => { for (const s of this.#sockets) s.destroy(); this.#server.close(() => { rmSync(this.#path, { force: true }); resolve(); }); });
  }

  #accept(sock: Socket, handle: Handler): void {
    this.#sockets.add(sock);
    sock.on("close", () => this.#sockets.delete(sock));
    sock.on("error", () => sock.destroy());
    createInterface({ input: sock }).on("line", async (line) => {
      let req: { id?: number; method?: string };
      try { req = JSON.parse(line); } catch { return; }
      const id = typeof req.id === "number" ? req.id : -1;
      const res: HostResponseDto = !ALLOWED.has(req.method ?? "")
        ? { id, ok: false, error: { kind: "denied", message: `method ${req.method} not allowed` } }
        : await handle(req as HostRequestDto).catch((e): HostResponseDto => ({ id, ok: false, error: { kind: "transport", message: String(e) } }));
      if (!sock.destroyed) sock.write(JSON.stringify(res) + "\n");
    });
  }
}
```

`src/adapters/outbound/ipc/HostCallError.ts`:

```ts
export class HostCallError extends Error {
  readonly kind: string; readonly code?: string | number;
  constructor(kind: string, message: string, code?: string | number) { super(message); this.name = "HostCallError"; this.kind = kind; this.code = code; }
}
```

`src/adapters/outbound/ipc/UnixSocketHostGateway.ts`:

```ts
import { connect, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";
import type { CatalogDto } from "../../../application/dto/CatalogDto.ts";
import type { ToolCallResultDto } from "../../../application/dto/ToolCallResultDto.ts";
import { CatalogMapper } from "../../../application/mappers/CatalogMapper.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../../domain/mcp/ToolName.ts";
import { HostCallError } from "./HostCallError.ts";

export class UnixSocketHostGateway implements HostGateway {
  readonly #sock: Socket; readonly #pending = new Map<number, (r: HostResponseDto) => void>(); #nextId = 1;

  private constructor(sock: Socket) {
    this.#sock = sock;
    createInterface({ input: sock }).on("line", (line) => {
      const res = JSON.parse(line) as HostResponseDto;
      this.#pending.get(res.id)?.(res);
      this.#pending.delete(res.id);
    });
    sock.on("close", () => {
      for (const cb of this.#pending.values()) cb({ id: -1, ok: false, error: { kind: "transport", message: "host connection closed" } });
      this.#pending.clear();
    });
  }

  static async connect(path: string, retries = 0, delayMs = 100): Promise<UnixSocketHostGateway> {
    for (let i = 0; ; i++) {
      try {
        return new UnixSocketHostGateway(await new Promise<Socket>((resolve, reject) => { const s = connect(path, () => resolve(s)); s.once("error", reject); }));
      } catch (e) {
        if (i >= retries) throw e;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  async catalog(server: ServerName): Promise<ToolCatalog> { return new CatalogMapper().toDomain(await this.raw<CatalogDto>({ method: "catalog", server: server.value })); }
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto> { return this.raw({ method: "call", server: server.value, tool: tool.value, args }); }
  health(): Promise<{ project: string; started: string[] }> { return this.raw({ method: "health" }); }
  close(): void { this.#sock.end(); }

  raw<T>(req: Record<string, unknown>): Promise<T> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (res) => (res.ok ? resolve(res.result as T) : reject(new HostCallError(res.error.kind, res.error.message, res.error.code))));
      this.#sock.write(JSON.stringify({ ...req, id }) + "\n");
    });
  }
}
```

`src/composition/StatePaths.ts`:

```ts
import { join } from "node:path";
import type { Project } from "../domain/project/Project.ts";

export class StatePaths {
  readonly #env: Record<string, string | undefined>;
  constructor(env: Record<string, string | undefined>) { this.#env = env; }
  root(): string { return join(this.#env.XDG_STATE_HOME ?? join(this.#env.HOME ?? "", ".local/state"), "underpass-pi"); }
  projectDir(p: Project): string { return join(this.root(), "projects", p.id.value); }
  socketOf(p: Project): string { return join(this.projectDir(p), "host.sock"); }
  binDir(): string { return join(this.#env.XDG_DATA_HOME ?? join(this.#env.HOME ?? "", ".local/share"), "underpass-pi", "bin"); }
  fingerprintsFile(): string { return join(this.root(), "fingerprints.json"); }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(host): puertos de proyecto, lock de propietario e IPC Unix 0600 con métodos cerrados"
```

---

### Task 10: `ServerPool`, `ServeHostRequest`, `ConnectToProjectHost` y proceso host

**Files:**
- Create:
  - aplicación: `src/application/services/ServerPool.ts`, `src/application/mappers/HostResponseMapper.ts`, `src/application/use-cases/{ReadServerCatalog,CallServerTool,ServeHostRequest,ConnectToProjectHost}.ts`
  - adaptador: `src/adapters/outbound/process/DetachedHostLauncher.ts`
  - composición y entry point: `src/composition/HostComposition.ts`, `bin/underpass-host.ts`
- Test: `tests/unit/application/services/ServerPool.test.ts`, `tests/unit/application/use-cases/ServeHostRequest.test.ts`, `tests/unit/application/use-cases/ConnectToProjectHost.test.ts`, `tests/unit/composition/HostComposition.test.ts`

**Interfaces:**
- Consumes: `McpConnector`, `McpConnection` y `ServerCommandDto` (Task 5); `ServerCommandFactory` y `Project` (Task 7); `HostRequestDto`, `HostResponseDto`, `HostGateway`, `HostLauncher`, `ProjectLocator`, `OwnerLock`, `UnixSocketHostServer` y `UnixSocketHostGateway` (Task 9); `CatalogMapper` y `ToolOutcomeMapper` (Task 4)
- Produces:
  - `ServerPool`:
    - `constructor(project: Project, connector: McpConnector, commands: Map<string, ServerCommandFactory>)`
    - `connection(server: ServerName): Promise<McpConnection>`: arranca en perezoso y una sola vez; si el proceso muere, se relanza en la siguiente petición
    - `started(): ServerName[]`
    - `close(): Promise<void>`
  - `ReadServerCatalog.execute(server): Promise<ToolCatalog>`
  - `CallServerTool.execute(server, tool, args): Promise<ToolOutcome>`
  - `HostResponseMapper`:
    - `success(id, result)`
    - `refusal(id, r: ToolRefusal)`
    - `failure(id, error: unknown)`, que da `rpc` si el error tiene `code` numérico y `transport` en otro caso
    - `invalid(id, message)`
  - `ServeHostRequest`:
    - `constructor(project: Project, pool: ServerPool)`
    - `execute(req: HostRequestDto): Promise<HostResponseDto>`: valida `server` y `tool` como VOs y devuelve `invalid` si no son válidos
  - `ConnectToProjectHost`:
    - `constructor(locator: ProjectLocator, connect: (socket: string, retries: number) => Promise<HostGateway>, socketOf: (p: Project) => string, launcher: HostLauncher)`
    - `execute(cwd: string): Promise<HostGateway>`
  - `DetachedHostLauncher` con `constructor(hostEntry: string, env)`
  - `HostComposition.run(projectCwd: string, env): Promise<void>`: toma el lock, arranca el servidor IPC y se apaga tras `UNDERPASS_HOST_IDLE_MS` sin clientes. `UNDERPASS_TEST_SERVER` sustituye los binarios sólo en tests.

- [ ] **Step 1: Tests que fallan**

`tests/unit/application/services/ServerPool.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";

const fake = new URL("../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;
const project = Project.of(ProjectRoot.of(process.cwd()));
const factory = (flavor: string) => ({ commandFor: () => ({ command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: flavor } }) });
const pool = (connector = new StdioMcpConnector(2000)) => new ServerPool(project, connector, new Map([["kmp", factory("kmp")], ["made", factory("made")]]));

test("perezoso, una sola apertura con llamadas concurrentes", async () => {
  let opens = 0;
  const inner = new StdioMcpConnector(2000);
  const p = pool({ open: (s, c) => { opens++; return inner.open(s, c); } });
  try {
    assert.deepEqual(p.started(), []);
    await Promise.all([p.connection(ServerName.KMP), p.connection(ServerName.KMP)]);
    assert.equal(opens, 1);
    assert.deepEqual(p.started().map(String), ["kmp"]);
  } finally { await p.close(); }
});

test("relanza tras la muerte del servidor", async () => {
  const p = pool();
  try {
    await assert.rejects((await p.connection(ServerName.KMP)).call(ToolName.of("kmp_die"), {}));
    await new Promise((r) => setTimeout(r, 20));
    const again = await p.connection(ServerName.KMP);
    assert.equal((await again.catalog()).names().length, 4);
  } finally { await p.close(); }
});

test("sin factoría para un servidor falla con un mensaje claro", async () => {
  const p = new ServerPool(project, new StdioMcpConnector(), new Map());
  await assert.rejects(p.connection(ServerName.MADE), /no command for made/);
});
```

`tests/unit/application/use-cases/ServeHostRequest.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ServeHostRequest } from "../../../../src/application/use-cases/ServeHostRequest.ts";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";

const fake = new URL("../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;
const project = Project.of(ProjectRoot.of(process.cwd()));
const factory = (flavor: string) => ({ commandFor: () => ({ command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: flavor } }) });

test("health, catálogo, éxito, negativa, RPC e inválidos", async () => {
  const pool = new ServerPool(project, new StdioMcpConnector(2000), new Map([["kmp", factory("kmp")], ["made", factory("made")]]));
  const uc = new ServeHostRequest(project, pool);
  try {
    assert.deepEqual(await uc.execute({ id: 1, method: "health" }), { id: 1, ok: true, result: { project: process.cwd(), started: [] } });
    const cat = await uc.execute({ id: 2, method: "catalog", server: "kmp" });
    assert.ok(cat.ok && (cat.result as { tools: unknown[] }).tools.length === 4);
    assert.deepEqual(await uc.execute({ id: 3, method: "call", server: "kmp", tool: "kmp_echo", args: { a: 1 } }), { id: 3, ok: true, result: { structured: { a: 1 }, text: "{\"a\":1}" } });
    assert.deepEqual(await uc.execute({ id: 4, method: "call", server: "made", tool: "made_fail", args: {} }), { id: 4, ok: false, error: { kind: "refused", code: "refused", message: "no grant" } });
    const rpc = await uc.execute({ id: 5, method: "call", server: "kmp", tool: "kmp_nope", args: {} });
    assert.ok(!rpc.ok && rpc.error.kind === "rpc" && rpc.error.code === -32602);
    const bad = await uc.execute({ id: 6, method: "call", server: "zzz", tool: "x", args: {} });
    assert.ok(!bad.ok && bad.error.kind === "invalid");
  } finally { await pool.close(); }
});
```

`tests/unit/application/use-cases/ConnectToProjectHost.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectToProjectHost } from "../../../../src/application/use-cases/ConnectToProjectHost.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";

const project = Project.of(ProjectRoot.of("/repo"));
const gateway = { catalog: async () => { throw new Error(); }, call: async () => ({ structured: null, text: "" }), health: async () => ({ project: "/repo", started: [] }), close: () => {} };

test("conecta sin lanzar si el host ya escucha", async () => {
  let launches = 0;
  const uc = new ConnectToProjectHost({ locate: () => project }, async () => gateway, () => "/s", { launch: () => { launches++; } });
  assert.equal(await uc.execute("/repo/sub"), gateway);
  assert.equal(launches, 0);
});

test("lanza el host y reintenta si no hay nadie escuchando", async () => {
  let launches = 0; let attempts = 0;
  const connect = async (_s: string, retries: number) => { attempts++; if (retries === 0) throw new Error("ENOENT"); return gateway; };
  const uc = new ConnectToProjectHost({ locate: () => project }, connect, () => "/s", { launch: (p) => { launches++; assert.ok(p.id.equals(project.id)); } });
  assert.equal(await uc.execute("/repo"), gateway);
  assert.deepEqual([launches, attempts], [1, 2]);
});
```

`tests/unit/composition/HostComposition.test.ts`. Es el test de integración del host real: dos clientes comparten un único proceso.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectToProjectHost } from "../../../src/application/use-cases/ConnectToProjectHost.ts";
import { GitProjectLocator } from "../../../src/adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { DetachedHostLauncher } from "../../../src/adapters/outbound/process/DetachedHostLauncher.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { ServerName } from "../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../src/domain/mcp/ToolName.ts";

const hostEntry = new URL("../../../bin/underpass-host.ts", import.meta.url).pathname;
const fake = new URL("../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;

test("dos conexiones desde el mismo proyecto comparten un único host", async () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", UNDERPASS_TEST_SERVER: `${process.execPath} ${fake}` };
  const paths = new StatePaths(env);
  let launches = 0;
  const inner = new DetachedHostLauncher(hostEntry, env);
  const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), { launch: (p) => { launches++; inner.launch(p); } });
  const a = await uc.execute(cwd);
  const b = await uc.execute(cwd);
  try {
    assert.equal(launches, 1);
    assert.deepEqual(await a.call(ServerName.KMP, ToolName.of("kmp_echo"), { x: 1 }), { structured: { x: 1 }, text: "{\"x\":1}" });
    assert.deepEqual(await b.health(), { project: cwd, started: ["kmp"] });
  } finally { a.close(); b.close(); }
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar**

`src/application/services/ServerPool.ts`:

```ts
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { Project } from "../../domain/project/Project.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import type { McpConnector } from "../ports/McpConnector.ts";
import type { ServerCommandFactory } from "../ports/ServerCommandFactory.ts";

export class ServerPool {
  readonly #project: Project; readonly #connector: McpConnector; readonly #commands: Map<string, ServerCommandFactory>;
  readonly #open = new Map<string, { server: ServerName; conn: Promise<McpConnection> }>();

  constructor(project: Project, connector: McpConnector, commands: Map<string, ServerCommandFactory>) {
    this.#project = project; this.#connector = connector; this.#commands = commands;
  }

  connection(server: ServerName): Promise<McpConnection> {
    const existing = this.#open.get(server.value);
    if (existing) return existing.conn;
    const factory = this.#commands.get(server.value);
    if (!factory) return Promise.reject(new Error(`no command for ${server}`));
    const conn = this.#connector.open(server, factory.commandFor(this.#project)).then((c) => { c.onExit(() => this.#open.delete(server.value)); return c; });
    conn.catch(() => this.#open.delete(server.value));
    this.#open.set(server.value, { server, conn });
    return conn;
  }

  started(): ServerName[] { return [...this.#open.values()].map((e) => e.server); }

  async close(): Promise<void> {
    const all = [...this.#open.values()];
    this.#open.clear();
    await Promise.allSettled(all.map(async (e) => (await e.conn).close()));
  }
}
```

`src/application/use-cases/ReadServerCatalog.ts`:

```ts
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ServerPool } from "../services/ServerPool.ts";

export class ReadServerCatalog {
  readonly #pool: ServerPool;
  constructor(pool: ServerPool) { this.#pool = pool; }
  async execute(server: ServerName): Promise<ToolCatalog> { return (await this.#pool.connection(server)).catalog(); }
}
```

`src/application/use-cases/CallServerTool.ts`:

```ts
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";
import type { ServerPool } from "../services/ServerPool.ts";

export class CallServerTool {
  readonly #pool: ServerPool;
  constructor(pool: ServerPool) { this.#pool = pool; }
  async execute(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
    return (await this.#pool.connection(server)).call(tool, args);
  }
}
```

`src/application/mappers/HostResponseMapper.ts`:

```ts
import type { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { HostResponseDto } from "../dto/HostResponseDto.ts";

export class HostResponseMapper {
  success(id: number, result: unknown): HostResponseDto { return { id, ok: true, result }; }
  refusal(id: number, r: ToolRefusal): HostResponseDto { return { id, ok: false, error: { kind: "refused", code: r.code.value, message: r.message } }; }
  invalid(id: number, message: string): HostResponseDto { return { id, ok: false, error: { kind: "invalid", message } }; }
  failure(id: number, error: unknown): HostResponseDto {
    const e = error as { code?: unknown; message?: string };
    return typeof e?.code === "number"
      ? { id, ok: false, error: { kind: "rpc", code: e.code, message: e.message ?? "rpc error" } }
      : { id, ok: false, error: { kind: "transport", message: e?.message ?? String(error) } };
  }
}
```

`src/application/use-cases/ServeHostRequest.ts`:

```ts
import { ServerName } from "../../domain/mcp/ServerName.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Project } from "../../domain/project/Project.ts";
import type { HostRequestDto } from "../dto/HostRequestDto.ts";
import type { HostResponseDto } from "../dto/HostResponseDto.ts";
import { CatalogMapper } from "../mappers/CatalogMapper.ts";
import { HostResponseMapper } from "../mappers/HostResponseMapper.ts";
import { ToolOutcomeMapper } from "../mappers/ToolOutcomeMapper.ts";
import type { ServerPool } from "../services/ServerPool.ts";
import { CallServerTool } from "./CallServerTool.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";

export class ServeHostRequest {
  readonly #project: Project; readonly #pool: ServerPool; readonly #responses = new HostResponseMapper();
  constructor(project: Project, pool: ServerPool) { this.#project = project; this.#pool = pool; }

  async execute(req: HostRequestDto): Promise<HostResponseDto> {
    if (req.method === "health") return this.#responses.success(req.id, { project: this.#project.root.value, started: this.#pool.started().map(String) });
    let server: ServerName; let tool: ToolName | null = null;
    try {
      server = ServerName.of(req.server);
      if (req.method === "call") tool = ToolName.of(req.tool);
    } catch (e) {
      return this.#responses.invalid(req.id, (e as Error).message);
    }
    try {
      if (req.method === "catalog") return this.#responses.success(req.id, new CatalogMapper().toDto(await new ReadServerCatalog(this.#pool).execute(server)));
      const outcome = await new CallServerTool(this.#pool).execute(server, tool!, (req as { args: Record<string, unknown> }).args ?? {});
      if (outcome instanceof ToolRefusal) return this.#responses.refusal(req.id, outcome);
      return this.#responses.success(req.id, new ToolOutcomeMapper().toDto(outcome));
    } catch (e) {
      return this.#responses.failure(req.id, e);
    }
  }
}
```

`src/application/use-cases/ConnectToProjectHost.ts`:

```ts
import type { Project } from "../../domain/project/Project.ts";
import type { HostGateway } from "../ports/HostGateway.ts";
import type { HostLauncher } from "../ports/HostLauncher.ts";
import type { ProjectLocator } from "../ports/ProjectLocator.ts";

type Connect = (socket: string, retries: number) => Promise<HostGateway>;
const LAUNCH_RETRIES = 50; // 50 × 100 ms = 5 s para que el host abra su socket

export class ConnectToProjectHost {
  readonly #locator: ProjectLocator; readonly #connect: Connect; readonly #socketOf: (p: Project) => string; readonly #launcher: HostLauncher;
  constructor(locator: ProjectLocator, connect: Connect, socketOf: (p: Project) => string, launcher: HostLauncher) {
    this.#locator = locator; this.#connect = connect; this.#socketOf = socketOf; this.#launcher = launcher;
  }
  async execute(cwd: string): Promise<HostGateway> {
    const project = this.#locator.locate(cwd);
    const socket = this.#socketOf(project);
    try { return await this.#connect(socket, 0); }
    catch {
      this.#launcher.launch(project);
      return this.#connect(socket, LAUNCH_RETRIES);
    }
  }
}
```

`src/adapters/outbound/process/DetachedHostLauncher.ts`:

```ts
import { spawn } from "node:child_process";
import type { HostLauncher } from "../../../application/ports/HostLauncher.ts";
import type { Project } from "../../../domain/project/Project.ts";

export class DetachedHostLauncher implements HostLauncher {
  readonly #entry: string; readonly #env: Record<string, string | undefined>;
  constructor(hostEntry: string, env: Record<string, string | undefined>) { this.#entry = hostEntry; this.#env = env; }
  launch(project: Project): void {
    spawn(process.execPath, [this.#entry, project.root.value], { env: this.#env, detached: true, stdio: "ignore" }).unref();
  }
}
```

`src/composition/HostComposition.ts`:

```ts
import { join } from "node:path";
import { FsOwnerLock } from "../adapters/outbound/fs/FsOwnerLock.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeServerCommandFactory } from "../adapters/outbound/process/MadeServerCommandFactory.ts";
import { UnixSocketHostServer } from "../adapters/inbound/ipc/UnixSocketHostServer.ts";
import type { ServerCommandFactory } from "../application/ports/ServerCommandFactory.ts";
import { ServerPool } from "../application/services/ServerPool.ts";
import { ServeHostRequest } from "../application/use-cases/ServeHostRequest.ts";
import { BinaryName } from "../domain/distribution/BinaryName.ts";
import { StorePath } from "../domain/made/StorePath.ts";
import { StatePaths } from "./StatePaths.ts";

export class HostComposition {
  static async run(projectCwd: string, env: Record<string, string | undefined>): Promise<void> {
    const project = new GitProjectLocator().locate(projectCwd);
    const paths = new StatePaths(env);
    const lock = new FsOwnerLock(paths.projectDir(project)).acquire();
    if (!lock.owned) return;

    const pool = new ServerPool(project, new StdioMcpConnector(60_000), HostComposition.#commands(env, paths));
    const serve = new ServeHostRequest(project, pool);
    const server = await UnixSocketHostServer.start(paths.socketOf(project), (req) => serve.execute(req));

    const idleMs = Number(env.UNDERPASS_HOST_IDLE_MS ?? 60_000);
    let idleSince = Date.now();
    const shutdown = async () => { clearInterval(timer); await server.close(); await pool.close(); lock.release(); };
    const timer = setInterval(() => {
      if (server.clients() > 0) idleSince = Date.now();
      else if (Date.now() - idleSince >= idleMs) void shutdown().then(() => process.exit(0));
    }, Math.max(100, Math.min(1000, idleMs / 2)));
    process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
  }

  static #commands(env: Record<string, string | undefined>, paths: StatePaths): Map<string, ServerCommandFactory> {
    const test = env.UNDERPASS_TEST_SERVER?.split(" ");
    if (test) {
      const fake = (flavor: string): ServerCommandFactory => ({ commandFor: (p) => ({ command: test[0], args: test.slice(1), cwd: p.root.value, env: { ...env, FAKE_FLAVOR: flavor } }) });
      return new Map([["kmp", fake("kmp")], ["made", fake("made")]]);
    }
    const pins = new JsonPinSetSource(new URL("../../pins.json", import.meta.url).pathname).load();
    const bin = (n: BinaryName) => join(paths.binDir(), pins.pinFor(n).installedFileName());
    const store = StorePath.of(env.MADE_MCP_STORE_PATH ?? join(env.XDG_STATE_HOME ?? join(env.HOME ?? "", ".local/state"), "underpass-made", "ceremonies.sqlite3"));
    const lazyMade: ServerCommandFactory = {
      commandFor: (p) => {
        const config = new FsMadeConfigurationRepository(env).load(store);
        if (!config) throw new Error("MADE private configuration missing; run `underpass setup`");
        return new MadeServerCommandFactory(bin(BinaryName.MADE), store, config, env).commandFor(p);
      },
    };
    return new Map([["kmp", new KmpServerCommandFactory(bin(BinaryName.KMP), env)], ["made", lazyMade]]);
  }
}
```

`bin/underpass-host.ts`:

```ts
#!/usr/bin/env node
import { HostComposition } from "../src/composition/HostComposition.ts";

await HostComposition.run(process.argv[2] ?? process.cwd(), process.env);
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %. Si `launches` es 2 en `HostComposition.test.ts`, el segundo `execute` no está conectando al socket existente: se corrige antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add src bin/underpass-host.ts tests
git commit -m "feat(host): pool perezoso de servidores y host por proyecto compartido entre ventanas"
```

---

### Task 11: Fases y extensiones de Pi

**Files:**
- Create:
  - dominio: `src/domain/session/{Phase,PhaseToolSelection}.ts`
  - aplicación: `src/application/use-cases/SelectPhaseTools.ts`
  - adaptadores Pi: `src/adapters/inbound/pi/{PiToolFactory,HostExtension,ServerToolsExtension,PiExtensionApi}.ts`, `src/adapters/inbound/pi/entry/{host,kmp,made}.ts`
  - composición: `src/composition/ExtensionComposition.ts`
  - aceptación: `tests/acceptance/load-extensions.ts`
- Test: `tests/unit/domain/session/phase.test.ts`, `tests/unit/adapters/inbound/pi/extensions.test.ts`

**Interfaces:**
- Consumes: `HostGateway` y `ConnectToProjectHost` (Tasks 9-10); `ToolCatalog`, `ToolDescriptor` y `ToolName` (Task 4)
- Produces:
  - `Phase.INTERACTIVE`, `Phase.DESIGN`, `Phase.of(raw)`
  - `PhaseToolSelection.standard()`, con `select(phase, registered: ToolName[], foreign: string[]): string[]`: los nombres ajenos (builtins de Pi) se conservan tal cual, porque no son del dominio Underpass
  - `SelectPhaseTools.execute(phase, registered, foreign): string[]`
  - `PiExtensionApi` es un `export type` con el subconjunto de `ExtensionAPI` que se usa (`on`, `registerTool`, `registerCommand`, `getAllTools`, `getActiveTools`, `setActiveTools` y `events`). Así los adaptadores se prueban con un doble sin importar Pi.
  - `PiToolFactory`:
    - `constructor(toSchema: (json: Record<string, unknown>) => unknown, maxText = 16_000)`
    - `create(server: ServerName, tool: ToolDescriptor, gateway: () => Promise<HostGateway>)`: devuelve la definición de tool de Pi
  - `HostExtension`:
    - `constructor(connect: (cwd: string) => Promise<HostGateway>, select: SelectPhaseTools)`
    - `register(pi: PiExtensionApi): void`
    - `gateway(): Promise<HostGateway>`
  - `ServerToolsExtension`:
    - `constructor(server: ServerName, host: HostExtension, tools: PiToolFactory, select: SelectPhaseTools)`
    - `register(pi): void`
  - Entry points: `export default (pi) => ExtensionComposition.host(pi)`, y el equivalente con `kmp(pi)` y `made(pi)`. La composición comparte un único `HostExtension` por proceso Pi.

- [ ] **Step 1: Tests que fallan**

`tests/unit/domain/session/phase.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const t = (xs: string[]) => xs.map((x) => ToolName.of(x));

test("interactivo: KMP de lectura y escritura explícita; nunca control de MADE; conserva ajenas", () => {
  const out = PhaseToolSelection.standard().select(Phase.INTERACTIVE, t(["kmp_ask", "kmp_ingest", "made_claim_ceremony_step", "made_design_ceremony"]), ["read", "bash"]);
  assert.deepEqual(out.sort(), ["bash", "kmp_ask", "read"]);
});

test("diseño añade la autoría de MADE", () => {
  const out = PhaseToolSelection.standard().select(Phase.DESIGN, t(["kmp_ask", "made_design_ceremony", "made_claim_ceremony_step"]), []);
  assert.deepEqual(out.sort(), ["kmp_ask", "made_design_ceremony"]);
});

test("Phase valida", () => {
  assert.ok(Phase.of("design").equals(Phase.DESIGN));
  assert.throws(() => Phase.of("run"), DomainError);
});
```

`tests/unit/adapters/inbound/pi/extensions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostExtension } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import { ServerToolsExtension } from "../../../../../src/adapters/inbound/pi/ServerToolsExtension.ts";
import { PiToolFactory } from "../../../../../src/adapters/inbound/pi/PiToolFactory.ts";
import { HostCallError } from "../../../../../src/adapters/outbound/ipc/HostCallError.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import { McpToolMapper } from "../../../../../src/application/mappers/McpToolMapper.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../../src/domain/mcp/ServerIdentity.ts";
import { ToolCatalog } from "../../../../../src/domain/mcp/ToolCatalog.ts";
import { SemVer } from "../../../../../src/domain/distribution/SemVer.ts";

class FakePi {
  handlers = new Map<string, ((e: unknown, ctx: unknown) => unknown)[]>();
  bus = new Map<string, ((d: unknown) => unknown)[]>();
  tools: { name: string; execute: Function }[] = [];
  active = ["read", "bash"];
  commands = new Map<string, { handler: (a: string, ctx: unknown) => Promise<void> }>();
  notes: string[] = [];
  on(ev: string, h: (e: unknown, ctx: unknown) => unknown) { (this.handlers.get(ev) ?? this.handlers.set(ev, []).get(ev)!).push(h); }
  registerTool(t: { name: string; execute: Function }) { this.tools.push(t); }
  registerCommand(n: string, o: { handler: (a: string, ctx: unknown) => Promise<void> }) { this.commands.set(n, o); }
  getAllTools() { return [...["read", "bash"].map((name) => ({ name })), ...this.tools.map((t) => ({ name: t.name }))]; }
  getActiveTools() { return [...this.active]; }
  setActiveTools(n: string[]) { this.active = n; }
  events = { on: (ev: string, h: (d: unknown) => unknown) => { (this.bus.get(ev) ?? this.bus.set(ev, []).get(ev)!).push(h); }, emit: (ev: string, d: unknown) => { for (const h of this.bus.get(ev) ?? []) h(d); } };
  ctx = { cwd: "/repo", hasUI: true, ui: { notify: (m: string) => { this.notes.push(m); } } };
  async fire(ev: string) { for (const h of this.handlers.get(ev) ?? []) await h({}, this.ctx); await new Promise((r) => setTimeout(r, 0)); }
}

const catalog = (server: ServerName, names: string[]) => ToolCatalog.of(server, ServerIdentity.of("s", SemVer.of("1.0.0")), names.map((n) => new McpToolMapper().toDomain({ name: n, inputSchema: { type: "object" } })));

function gatewayFake(closed: { v: boolean }) {
  return {
    catalog: async (s: ServerName) => catalog(s, s.equals(ServerName.KMP) ? ["kmp_ask", "kmp_ingest"] : ["made_claim_ceremony_step", "made_design_ceremony"]),
    call: async (_s: ServerName, t: { value: string }) => { if (t.value === "kmp_ingest") throw new HostCallError("refused", "nope", "invalid_argument"); return { structured: { ok: 1 }, text: "x".repeat(20) }; },
    health: async () => ({ project: "/repo", started: ["kmp"] }),
    close: () => { closed.v = true; },
  };
}

test("session_start conecta, registra tools de ambos servidores y activa sólo las de la fase", async () => {
  const pi = new FakePi(); const closed = { v: false }; let connects = 0;
  const select = new SelectPhaseTools(PhaseToolSelection.standard());
  const host = new HostExtension(async () => { connects++; return gatewayFake(closed); }, select);
  const factory = new PiToolFactory((j) => ({ wrapped: j }), 10);
  host.register(pi as never);
  new ServerToolsExtension(ServerName.KMP, host, factory, select).register(pi as never);
  new ServerToolsExtension(ServerName.MADE, host, factory, select).register(pi as never);
  assert.equal(connects, 0); // la factoría no abre nada
  await pi.fire("session_start");
  assert.equal(connects, 1);
  assert.deepEqual(pi.tools.map((t) => t.name).sort(), ["kmp_ask", "kmp_ingest", "made_claim_ceremony_step", "made_design_ceremony"]);
  assert.deepEqual(pi.active.sort(), ["bash", "kmp_ask", "read"]);

  const ask = pi.tools.find((t) => t.name === "kmp_ask")!;
  const res = await ask.execute("c1", {});
  assert.match(res.content[0].text, /^x{10}\n\[truncated 10 chars/);
  assert.deepEqual(res.details, { ok: 1 });
  await assert.rejects(pi.tools.find((t) => t.name === "kmp_ingest")!.execute("c2", {}), /kmp_ingest refused \(invalid_argument\): nope/);

  await pi.commands.get("underpass-phase")!.handler("design", pi.ctx);
  assert.deepEqual(pi.active.sort(), ["bash", "kmp_ask", "made_design_ceremony", "read"]);
  await pi.commands.get("underpass-status")!.handler("", pi.ctx);
  assert.match(pi.notes.at(-1)!, /project: \/repo[\s\S]*kmp 1\.0\.0: 2 tools/);

  await pi.fire("session_shutdown");
  assert.equal(closed.v, true);
});

test("fallo de conexión se notifica y no rompe la sesión", async () => {
  const pi = new FakePi();
  const host = new HostExtension(async () => { throw new Error("no host"); }, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  await pi.fire("session_start");
  assert.match(pi.notes[0], /Underpass host unavailable: no host/);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar el dominio y la aplicación**

`src/domain/session/Phase.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class Phase extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly INTERACTIVE = new Phase("interactive");
  static readonly DESIGN = new Phase("design");
  static of(raw: string): Phase {
    if (raw === "interactive") return Phase.INTERACTIVE;
    if (raw === "design") return Phase.DESIGN;
    throw DomainError.because(`unknown phase ${raw}`);
  }
}
```

`src/domain/session/PhaseToolSelection.ts`:

```ts
import type { ToolName } from "../mcp/ToolName.ts";
import { Phase } from "./Phase.ts";

const KMP_INTERACTIVE = ["kmp_guide", "kmp_wake", "kmp_ask", "kmp_time", "kmp_trace", "kmp_inspect", "kmp_relate", "kmp_write_memory", "kmp_relabel", "kmp_condense", "kmp_view_open", "kmp_view_get_state", "kmp_view_apply_intent"];
const MADE_DESIGN = ["made_design_ceremony", "made_validate_ceremony_draft", "made_explain_ceremony_draft", "made_diff_ceremony_definitions", "made_publish_ceremony_definition", "made_list_contracts", "made_get_help"];

export class PhaseToolSelection {
  readonly #byPhase: Map<string, Set<string>>;
  private constructor(m: Map<string, Set<string>>) { this.#byPhase = m; }
  static standard(): PhaseToolSelection {
    return new PhaseToolSelection(new Map([
      [Phase.INTERACTIVE.value, new Set(KMP_INTERACTIVE)],
      [Phase.DESIGN.value, new Set([...KMP_INTERACTIVE, ...MADE_DESIGN])],
    ]));
  }
  select(phase: Phase, registered: ToolName[], foreign: string[]): string[] {
    const wanted = this.#byPhase.get(phase.value)!;
    return [...foreign, ...registered.filter((t) => wanted.has(t.value)).map((t) => t.value)];
  }
}
```

`src/application/use-cases/SelectPhaseTools.ts`:

```ts
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Phase } from "../../domain/session/Phase.ts";
import type { PhaseToolSelection } from "../../domain/session/PhaseToolSelection.ts";

export class SelectPhaseTools {
  readonly #selection: PhaseToolSelection;
  constructor(selection: PhaseToolSelection) { this.#selection = selection; }
  execute(phase: Phase, registered: ToolName[], foreign: string[]): string[] { return this.#selection.select(phase, registered, foreign); }
}
```

- [ ] **Step 4: Implementar los adaptadores Pi**

`src/adapters/inbound/pi/PiExtensionApi.ts`:

```ts
export type PiExtensionApi = {
  on(event: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean; ui: { notify(m: string, t?: string): void } }) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: { description?: string; getArgumentCompletions?: (p: string) => { value: string; label: string }[]; handler: (args: string, ctx: { cwd: string; hasUI: boolean; ui: { notify(m: string, t?: string): void } }) => Promise<void> }): void;
  getAllTools(): { name: string }[];
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
  events: { on(event: string, handler: (data: unknown) => unknown): void; emit(event: string, data: unknown): void };
};
```

`src/adapters/inbound/pi/PiToolFactory.ts`:

```ts
import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolDescriptor } from "../../../domain/mcp/ToolDescriptor.ts";
import { HostCallError } from "../../outbound/ipc/HostCallError.ts";

export class PiToolFactory {
  readonly #toSchema: (json: Record<string, unknown>) => unknown; readonly #maxText: number;
  constructor(toSchema: (json: Record<string, unknown>) => unknown, maxText = 16_000) { this.#toSchema = toSchema; this.#maxText = maxText; }

  create(server: ServerName, tool: ToolDescriptor, gateway: () => Promise<HostGateway>) {
    const max = this.#maxText;
    return {
      name: tool.name.value,
      label: tool.name.value,
      description: tool.description.value,
      parameters: this.#toSchema(tool.schema.toJson()),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const r = await (await gateway()).call(server, tool.name, params);
          const text = r.text.length > max ? `${r.text.slice(0, max)}\n[truncated ${r.text.length - max} chars; full result in details]` : r.text;
          return { content: [{ type: "text" as const, text }], details: r.structured };
        } catch (e) {
          if (e instanceof HostCallError) throw new Error(`${tool.name} ${e.kind} (${e.code ?? "-"}): ${e.message}`);
          throw e;
        }
      },
    };
  }
}
```

`src/adapters/inbound/pi/HostExtension.ts`:

```ts
import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { SelectPhaseTools } from "../../../application/use-cases/SelectPhaseTools.ts";
import { ServerName } from "../../../domain/mcp/ServerName.ts";
import { ToolName } from "../../../domain/mcp/ToolName.ts";
import { Phase } from "../../../domain/session/Phase.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";

export const HOST_READY = "underpass:host-ready";
const isOurs = (n: string) => n.startsWith("kmp_") || n.startsWith("made_");

export class HostExtension {
  readonly #connect: (cwd: string) => Promise<HostGateway>; readonly #select: SelectPhaseTools;
  #gateway: Promise<HostGateway> | null = null;

  constructor(connect: (cwd: string) => Promise<HostGateway>, select: SelectPhaseTools) { this.#connect = connect; this.#select = select; }

  gateway(): Promise<HostGateway> {
    if (!this.#gateway) return Promise.reject(new Error("Underpass host not connected yet"));
    return this.#gateway;
  }

  applyPhase(pi: PiExtensionApi, phase: Phase): void {
    const ours = pi.getAllTools().map((t) => t.name).filter(isOurs).map((n) => ToolName.of(n));
    const foreign = pi.getActiveTools().filter((n) => !isOurs(n));
    pi.setActiveTools(this.#select.execute(phase, ours, foreign));
  }

  register(pi: PiExtensionApi): void {
    pi.on("session_start", async (_e, ctx) => {
      this.#gateway = this.#connect(ctx.cwd);
      try { await this.#gateway; pi.events.emit(HOST_READY, null); }
      catch (e) { this.#gateway = null; if (ctx.hasUI) ctx.ui.notify(`Underpass host unavailable: ${(e as Error).message}`, "error"); }
    });
    pi.on("session_shutdown", async () => {
      const g = this.#gateway; this.#gateway = null;
      if (g) (await g.catch(() => null))?.close();
    });
    pi.registerCommand("underpass-status", {
      description: "Show Underpass host, servers and catalog fingerprints",
      handler: async (_a, ctx) => {
        const g = await this.gateway();
        const h = await g.health();
        const lines = [`project: ${h.project}`, `servers: ${h.started.join(", ") || "none started"}`];
        for (const s of h.started) {
          const c = await g.catalog(ServerName.of(s));
          lines.push(`${s} ${c.identity.version}: ${c.names().length} tools, ${c.fingerprint().short()}`);
        }
        ctx.ui.notify(lines.join("\n"), "info");
      },
    });
    pi.registerCommand("underpass-phase", {
      description: "Switch active Underpass tools: interactive | design",
      getArgumentCompletions: (p) => ["interactive", "design"].filter((x) => x.startsWith(p)).map((x) => ({ value: x, label: x })),
      handler: async (args, ctx) => {
        const phase = Phase.of(args.trim() || "interactive");
        this.applyPhase(pi, phase);
        ctx.ui.notify(`Underpass phase: ${phase}`, "info");
      },
    });
  }
}
```

`src/adapters/inbound/pi/ServerToolsExtension.ts`:

```ts
import type { SelectPhaseTools } from "../../../application/use-cases/SelectPhaseTools.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import { Phase } from "../../../domain/session/Phase.ts";
import { HOST_READY, type HostExtension } from "./HostExtension.ts";
import type { PiExtensionApi } from "./PiExtensionApi.ts";
import type { PiToolFactory } from "./PiToolFactory.ts";

export class ServerToolsExtension {
  readonly #server: ServerName; readonly #host: HostExtension; readonly #tools: PiToolFactory; #registered = false;
  constructor(server: ServerName, host: HostExtension, tools: PiToolFactory, _select: SelectPhaseTools) { this.#server = server; this.#host = host; this.#tools = tools; }

  register(pi: PiExtensionApi): void {
    pi.events.on(HOST_READY, async () => {
      if (this.#registered) return;
      this.#registered = true;
      const catalog = await (await this.#host.gateway()).catalog(this.#server);
      for (const t of catalog.tools()) pi.registerTool(this.#tools.create(this.#server, t, () => this.#host.gateway()));
      this.#host.applyPhase(pi, Phase.INTERACTIVE);
    });
  }
}
```

`src/composition/ExtensionComposition.ts`:

```ts
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { DetachedHostLauncher } from "../adapters/outbound/process/DetachedHostLauncher.ts";
import { HostExtension } from "../adapters/inbound/pi/HostExtension.ts";
import type { PiExtensionApi } from "../adapters/inbound/pi/PiExtensionApi.ts";
import { PiToolFactory } from "../adapters/inbound/pi/PiToolFactory.ts";
import { ServerToolsExtension } from "../adapters/inbound/pi/ServerToolsExtension.ts";
import { ConnectToProjectHost } from "../application/use-cases/ConnectToProjectHost.ts";
import { SelectPhaseTools } from "../application/use-cases/SelectPhaseTools.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { PhaseToolSelection } from "../domain/session/PhaseToolSelection.ts";
import { StatePaths } from "./StatePaths.ts";

export class ExtensionComposition {
  static #host: HostExtension | null = null;
  static #select = new SelectPhaseTools(PhaseToolSelection.standard());

  static #shared(): HostExtension {
    if (!this.#host) {
      const paths = new StatePaths(process.env);
      const connect = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p),
        new DetachedHostLauncher(new URL("../../bin/underpass-host.ts", import.meta.url).pathname, process.env));
      this.#host = new HostExtension((cwd) => connect.execute(cwd), this.#select);
    }
    return this.#host;
  }

  static host(pi: PiExtensionApi): void { this.#shared().register(pi); }

  static server(pi: PiExtensionApi, server: ServerName, toSchema: (json: Record<string, unknown>) => unknown): void {
    new ServerToolsExtension(server, this.#shared(), new PiToolFactory(toSchema), this.#select).register(pi);
  }
}
```

`src/adapters/inbound/pi/entry/host.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ExtensionComposition } from "../../../../composition/ExtensionComposition.ts";

export default (pi: ExtensionAPI) => ExtensionComposition.host(pi as never);
```

`src/adapters/inbound/pi/entry/kmp.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ExtensionComposition } from "../../../../composition/ExtensionComposition.ts";
import { ServerName } from "../../../../domain/mcp/ServerName.ts";

export default (pi: ExtensionAPI) => ExtensionComposition.server(pi as never, ServerName.KMP, (json) => Type.Unsafe(json));
```

`src/adapters/inbound/pi/entry/made.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ExtensionComposition } from "../../../../composition/ExtensionComposition.ts";
import { ServerName } from "../../../../domain/mcp/ServerName.ts";

export default (pi: ExtensionAPI) => ExtensionComposition.server(pi as never, ServerName.MADE, (json) => Type.Unsafe(json));
```

Los entry points importan `composition`, y el test de capas lo permite porque están en `src/adapters/inbound/pi/entry/`. Para que pase, se añade esta excepción explícita en `layers.test.ts`, antes del cálculo de `ALLOWED`:

```ts
const isEntry = (path: string) => path.startsWith("src/adapters/inbound/pi/entry/");
// dentro del bucle, antes de comprobar ALLOWED:
if (isEntry(file.path) && targetLayer === "composition") continue;
```

- [ ] **Step 5: Aceptación con el SDK real** `tests/acceptance/load-extensions.ts`

```ts
#!/usr/bin/env node
// Uso: node tests/acceptance/load-extensions.ts <proyecto>
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const prefix = process.env.UNDERPASS_PI_PREFIX ?? join(process.env.HOME!, ".local/share/underpass-pi/pi-0.87.1");
const pkgDir = join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent");
const main = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entry = typeof main.exports === "string" ? main.exports : main.exports?.["."]?.import ?? main.exports?.["."]?.default ?? main.main;
const sdk = await import(pathToFileURL(join(pkgDir, entry)).href);
const root = new URL("../../", import.meta.url).pathname;
const cwd = process.argv[2] ?? process.cwd();

const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd, agentDir: sdk.getAgentDir(), settingsManager, noExtensions: true,
  additionalExtensionPaths: ["host", "kmp", "made"].map((e) => join(root, "src/adapters/inbound/pi/entry", `${e}.ts`)),
});
await resourceLoader.reload();
const loaded = resourceLoader.getExtensions();
if (loaded.errors.length) { console.error(loaded.errors); process.exit(1); }
const { session } = await sdk.createAgentSession({ cwd, resourceLoader, settingsManager, sessionManager: sdk.SessionManager.inMemory(cwd) });
await session.bindExtensions({}); // en el SDK, session_start no se dispara solo
const deadline = Date.now() + 15_000;
let names: string[] = [];
while (Date.now() < deadline) {
  names = session.getAllTools().map((t: { name: string }) => t.name);
  if (names.includes("kmp_ask") && names.includes("made_claim_ceremony_step")) break;
  await new Promise((r) => setTimeout(r, 200));
}
const active = session.getActiveToolNames();
const checks = { kmpRegistered: names.includes("kmp_ask"), madeRegistered: names.includes("made_claim_ceremony_step"), kmpActive: active.includes("kmp_ask"), madeControlHidden: !active.includes("made_claim_ceremony_step") };
console.log(JSON.stringify({ tools: names.length, active: active.length, checks }, null, 2));
session.dispose();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
```

- [ ] **Step 6: Ejecutar**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %, arquitectura en verde.

La aceptación con el SDK se ejecuta en la Task 13, porque necesita `underpass setup`.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat(pi): extensiones host/kmp/made como adaptadores inbound con fases de dominio"
```

---

### Task 12: Diagnóstico y CLI `underpass setup | doctor | update`

**Files:**
- Create:
  - dominio: `src/domain/diagnosis/{CheckSection,CheckStatus,CheckName,CheckDetail,Check,DiagnosisReport,FingerprintDrift}.ts`
  - puertos: `src/application/ports/{AuthorizationBootstrapper,KmpLifecycle,PiPackageManager,PiRuntimeInspector,FingerprintRepository}.ts`
  - DTO, mapper y casos de uso: `src/application/dto/CheckDto.ts`, `src/application/mappers/CheckMapper.ts`, `src/application/use-cases/{BootstrapMadeAuthorization,DiscoverMadeCapabilities,SetupInstallation,DiagnoseInstallation}.ts`
  - adaptadores: `src/adapters/outbound/process/{MadeCliAuthorizationBootstrapper,KmpCliLifecycle,PiCliPackageManager,PiCliRuntimeInspector}.ts`, `src/adapters/outbound/fs/FsFingerprintRepository.ts`, `src/adapters/inbound/cli/{CheckRenderer,UnderpassCli}.ts`
  - composición y entry point: `src/composition/CliComposition.ts`, `bin/underpass.ts`
- Test: `tests/unit/domain/diagnosis/diagnosis.test.ts`, `tests/unit/application/use-cases/SetupAndDiagnose.test.ts`, `tests/unit/adapters/inbound/cli/UnderpassCli.test.ts`, `tests/unit/adapters/outbound/process/cli-adapters.test.ts`

**Interfaces:**
- Produces:
  - dominio:
    - `CheckSection.PI | KMP | MADE | HOST`; `CheckStatus.OK | WARN | FAIL`; `CheckName.of`; `CheckDetail.of`
    - `Check.ok(section, name, detail)`, `Check.warn(...)`, `Check.fail(...)`
    - `DiagnosisReport.of(checks)`, con `add(...checks): DiagnosisReport`, `hasFailures(): boolean`, `checks(): Check[]` y `sections(): CheckSection[]`
    - `FingerprintDrift.compare(previous: Map<string, CatalogFingerprint>, current: Map<string, CatalogFingerprint>): Check[]`
  - puertos:
    - `interface AuthorizationBootstrapper { bootstrap(store: StorePath, config: MadeConfiguration): Promise<string> }` (devuelve el recibo)
    - `interface KmpLifecycle { setup(): Promise<void>; doctor(): Promise<boolean> }`
    - `interface PiPackageManager { install(packageDir: string): Promise<void>; isRegistered(packageName: string): Promise<boolean> }`
    - `interface PiRuntimeInspector { version(): Promise<SemVer | null> }`
    - `interface FingerprintRepository { load(): Map<string, CatalogFingerprint>; save(m: Map<string, CatalogFingerprint>): void }`
  - `CheckDto = { section: string; status: string; name: string; detail: string }`; `CheckMapper.toDto(c: Check): CheckDto`
  - casos de uso:
    - `BootstrapMadeAuthorization.execute(store, config): Promise<Check>`
    - `DiscoverMadeCapabilities.execute(connection: McpConnection): Promise<MadeCapabilities>`
    - `SetupInstallation.execute(): Promise<DiagnosisReport>`, que encadena `InstallPinnedBinaries` → `EnsureMadeConfiguration` → `BootstrapMadeAuthorization` → `KmpLifecycle.setup` → `PiPackageManager.install`
    - `DiagnoseInstallation.execute(record: boolean): Promise<DiagnosisReport>`: versión y paquete de Pi, binarios, perfiles, capacidades de MADE, deriva de huellas y `kmp-mcp doctor`
  - adaptadores de entrada:
    - `CheckRenderer.render(dtos: CheckDto[]): string`
    - `UnderpassCli.run(argv: string[]): Promise<number>`, que devuelve el exit code

- [ ] **Step 1: Tests que fallan**

`tests/unit/domain/diagnosis/diagnosis.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Check } from "../../../../src/domain/diagnosis/Check.ts";
import { CheckSection } from "../../../../src/domain/diagnosis/CheckSection.ts";
import { CheckName } from "../../../../src/domain/diagnosis/CheckName.ts";
import { CheckDetail } from "../../../../src/domain/diagnosis/CheckDetail.ts";
import { CheckStatus } from "../../../../src/domain/diagnosis/CheckStatus.ts";
import { DiagnosisReport } from "../../../../src/domain/diagnosis/DiagnosisReport.ts";
import { FingerprintDrift } from "../../../../src/domain/diagnosis/FingerprintDrift.ts";
import { CatalogFingerprint } from "../../../../src/domain/mcp/CatalogFingerprint.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const n = CheckName.of("x"); const d = CheckDetail.of("y");

test("report acumula, detecta FAIL y conserva orden de secciones", () => {
  const r = DiagnosisReport.of([Check.ok(CheckSection.KMP, n, d)]).add(Check.fail(CheckSection.MADE, n, d), Check.warn(CheckSection.KMP, n, d));
  assert.equal(r.hasFailures(), true);
  assert.deepEqual(r.sections().map(String), ["kmp", "made"]);
  assert.equal(DiagnosisReport.of([Check.ok(CheckSection.PI, n, d)]).hasFailures(), false);
  assert.ok(Check.fail(CheckSection.PI, n, d).status.equals(CheckStatus.FAIL));
  assert.throws(() => CheckName.of(""), DomainError);
  assert.throws(() => CheckSection.of("db"), DomainError);
});

test("deriva de huellas: nueva, igual y cambiada", () => {
  const a = CatalogFingerprint.of("a".repeat(64)); const b = CatalogFingerprint.of("b".repeat(64));
  const checks = FingerprintDrift.compare(new Map([["made", a], ["kmp", a]]), new Map([["kmp", a], ["made", b], ["pi", a]].filter(([k]) => k !== "pi") as [string, CatalogFingerprint][]));
  assert.deepEqual(checks.map((c) => [c.section.value, c.status.value]), [["kmp", "OK"], ["made", "WARN"]]);
  assert.match(FingerprintDrift.compare(new Map(), new Map([["kmp", a]]))[0].detail.value, /recorded/);
});
```

`tests/unit/application/use-cases/SetupAndDiagnose.test.ts`. Prueba la orquestación con dobles de todos los puertos:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SetupInstallation } from "../../../../src/application/use-cases/SetupInstallation.ts";
import { DiagnoseInstallation } from "../../../../src/application/use-cases/DiagnoseInstallation.ts";
import { BootstrapMadeAuthorization } from "../../../../src/application/use-cases/BootstrapMadeAuthorization.ts";
import { EnsureMadeConfiguration } from "../../../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { InstallPinnedBinaries } from "../../../../src/application/use-cases/InstallPinnedBinaries.ts";
import { VerifyServerProfiles } from "../../../../src/application/use-cases/VerifyServerProfiles.ts";
import { DiscoverMadeCapabilities } from "../../../../src/application/use-cases/DiscoverMadeCapabilities.ts";
import { ToolProfiles } from "../../../../src/domain/contracts/ToolProfiles.ts";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { McpToolMapper } from "../../../../src/application/mappers/McpToolMapper.ts";
import type { MadeConfiguration } from "../../../../src/domain/made/MadeConfiguration.ts";

const store = StorePath.of("/s/ceremonies.sqlite3");
const profiles = ToolProfiles.standard();
const catalogFor = (s: ServerName) => ToolCatalog.of(s, ServerIdentity.of("x", SemVer.of("1.0.0")),
  [...new Set(profiles.forServer(s).flatMap((p) => p.required.map(String)))].map((n) => new McpToolMapper().toDomain({ name: n, inputSchema: {} })));
const connection = (s: ServerName) => ({ server: s, identity: ServerIdentity.of("x", SemVer.of("0.8.0")), protocol: null as never, onExit() {}, close: async () => {},
  catalog: async () => catalogFor(s),
  call: async () => ToolSuccess.of({ schema_version: "1.0", server: { version: "0.8.0" }, declared_limits: [{ id: "agent_roster_is_process_local" }] }, "") });

function deps(overrides: Record<string, unknown> = {}) {
  let saved: Map<string, unknown> | null = null;
  const repo = { stored: null as MadeConfiguration | null, load() { return this.stored; }, create(_s: StorePath, c: MadeConfiguration) { this.stored = c; }, locationOf: () => "/cfg" };
  return {
    install: { execute: async () => [] } as unknown as InstallPinnedBinaries,
    ensure: new EnsureMadeConfiguration(repo, { bytes: (k) => new Uint8Array(k) }),
    bootstrap: new BootstrapMadeAuthorization({ bootstrap: async () => "authorization policy opened" }),
    kmp: { setup: async () => {}, doctor: async () => true },
    pi: { install: async () => {}, isRegistered: async () => true },
    runtime: { version: async () => SemVer.of("0.87.1") },
    fingerprints: { load: () => new Map(), save: (m: Map<string, unknown>) => { saved = m; } },
    connections: async (s: ServerName) => connection(s),
    saved: () => saved,
    ...overrides,
  };
}

test("setup encadena todo y no falla con dobles sanos", async () => {
  const d = deps();
  const r = await new SetupInstallation(d.install, d.ensure, d.bootstrap, d.kmp, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), false);
  assert.deepEqual(r.checks().map((c) => c.name.value), ["pinned binaries", "private configuration", "authorization bootstrap", "kmp-mcp setup", "underpass-pi package"]);
});

test("setup se detiene si la descarga falla", async () => {
  const d = deps({ install: { execute: async () => { throw new Error("sha256 mismatch for kmp-mcp"); } } });
  const r = await new SetupInstallation(d.install as never, d.ensure, d.bootstrap, d.kmp, d.pi, store, "/pkg").execute();
  assert.equal(r.hasFailures(), true);
  assert.equal(r.checks().length, 1);
});

test("doctor verifica perfiles, capacidades y registra huellas", async () => {
  const d = deps();
  const doctor = new DiagnoseInstallation(d.install, d.runtime, d.pi, d.kmp, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1"));
  const r = await doctor.execute(true);
  assert.equal(r.hasFailures(), false, JSON.stringify(r.checks().map((c) => [c.name.value, c.status.value, c.detail.value])));
  assert.deepEqual([...d.saved()!.keys()], ["kmp", "made"]);
});

test("doctor marca FAIL con Pi ausente o de otra versión, y WARN si kmp doctor avisa", async () => {
  const d = deps({ runtime: { version: async () => null }, kmp: { setup: async () => {}, doctor: async () => false } });
  const r = await new DiagnoseInstallation(d.install, d.runtime as never, d.pi, d.kmp as never, d.fingerprints, d.connections, new VerifyServerProfiles(profiles), new DiscoverMadeCapabilities(), SemVer.of("0.87.1")).execute(false);
  assert.equal(r.hasFailures(), true);
  assert.ok(r.checks().some((c) => c.name.value === "kmp-mcp doctor" && c.status.value === "WARN"));
  assert.equal(d.saved(), null);
});
```

`tests/unit/adapters/inbound/cli/UnderpassCli.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnderpassCli } from "../../../../../src/adapters/inbound/cli/UnderpassCli.ts";
import { CheckRenderer } from "../../../../../src/adapters/inbound/cli/CheckRenderer.ts";
import { DiagnosisReport } from "../../../../../src/domain/diagnosis/DiagnosisReport.ts";
import { Check } from "../../../../../src/domain/diagnosis/Check.ts";
import { CheckSection } from "../../../../../src/domain/diagnosis/CheckSection.ts";
import { CheckName } from "../../../../../src/domain/diagnosis/CheckName.ts";
import { CheckDetail } from "../../../../../src/domain/diagnosis/CheckDetail.ts";

const report = (fail: boolean) => DiagnosisReport.of([(fail ? Check.fail : Check.ok)(CheckSection.MADE, CheckName.of("profile made-worker"), CheckDetail.of("d"))]);

test("render agrupa por sección", () => {
  assert.equal(new CheckRenderer().render([{ section: "kmp", status: "OK", name: "a", detail: "b" }, { section: "kmp", status: "FAIL", name: "c", detail: "d" }]), "[kmp]\n  OK   a — b\n  FAIL c — d");
});

test("verbos y exit codes", async () => {
  const out: string[] = [];
  const cli = new UnderpassCli({ execute: async () => report(false) }, { execute: async () => report(true) }, (s) => out.push(s));
  assert.equal(await cli.run(["setup"]), 1);  // setup + doctor; doctor falla
  assert.equal(await cli.run(["update"]), 1);
  assert.equal(await cli.run(["doctor"]), 1);
  assert.equal(await cli.run(["nope"]), 2);
  assert.match(out.join("\n"), /FAIL profile made-worker/);
});
```

`tests/unit/adapters/outbound/process/cli-adapters.test.ts`. Los adaptadores de proceso se prueban con ejecutables falsos en un `PATH` temporal:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MadeCliAuthorizationBootstrapper } from "../../../../../src/adapters/outbound/process/MadeCliAuthorizationBootstrapper.ts";
import { KmpCliLifecycle } from "../../../../../src/adapters/outbound/process/KmpCliLifecycle.ts";
import { PiCliPackageManager } from "../../../../../src/adapters/outbound/process/PiCliPackageManager.ts";
import { PiCliRuntimeInspector } from "../../../../../src/adapters/outbound/process/PiCliRuntimeInspector.ts";
import { FsFingerprintRepository } from "../../../../../src/adapters/outbound/fs/FsFingerprintRepository.ts";
import { MadeConfiguration } from "../../../../../src/domain/made/MadeConfiguration.ts";
import { StorePath } from "../../../../../src/domain/made/StorePath.ts";
import { CatalogFingerprint } from "../../../../../src/domain/mcp/CatalogFingerprint.ts";

const script = (dir: string, name: string, body: string) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };

test("bootstrap de MADE pasa store y ids, nunca la clave", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bin-"));
  const log = join(dir, "args");
  const bin = script(dir, "made-mcp", `echo "$@" > ${log}; echo "authorization policy opened"`);
  const store = StorePath.of("/s/c.sqlite3");
  const cfg = MadeConfiguration.generateFor(store, new Uint8Array(32).fill(5));
  assert.equal(await new MadeCliAuthorizationBootstrapper(bin).bootstrap(store, cfg), "authorization policy opened");
  const args = readFileSync(log, "utf8");
  assert.match(args, /^bootstrap-authorization \/s\/c.sqlite3 --policy-id made-local-policy-\w+ --trusted-host-id made-local-host-\w+/);
  assert.equal(args.includes(cfg.cursorKey.reveal()), false);
  await assert.rejects(new MadeCliAuthorizationBootstrapper(script(dir, "bad", "echo boom >&2; exit 1")).bootstrap(store, cfg), /boom/);
});

test("kmp lifecycle, pi package manager, pi runtime y huellas", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bin-"));
  const kmp = script(dir, "kmp-mcp", `[ "$1" = doctor ] && exit 1; exit 0`);
  await new KmpCliLifecycle(kmp, dir, {}).setup();
  assert.equal(await new KmpCliLifecycle(kmp, dir, {}).doctor(), false);
  const pi = script(dir, "pi", `case "$1" in --version) echo 0.87.1;; list) echo "  /x/underpass-pi";; install) exit 0;; esac`);
  await new PiCliPackageManager(pi).install("/x/underpass-pi");
  assert.equal(await new PiCliPackageManager(pi).isRegistered("underpass-pi"), true);
  assert.equal((await new PiCliRuntimeInspector(pi).version())!.value, "0.87.1");
  assert.equal(await new PiCliRuntimeInspector(join(dir, "missing")).version(), null);
  const repo = new FsFingerprintRepository(join(dir, "fp.json"));
  assert.equal(repo.load().size, 0);
  repo.save(new Map([["kmp", CatalogFingerprint.of("a".repeat(64))]]));
  assert.equal(repo.load().get("kmp")!.value, "a".repeat(64));
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test`
Expected: FAIL, módulos no encontrados

- [ ] **Step 3: Implementar el dominio de diagnóstico**

`src/domain/diagnosis/CheckSection.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CheckSection extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly PI = new CheckSection("pi");
  static readonly KMP = new CheckSection("kmp");
  static readonly MADE = new CheckSection("made");
  static readonly HOST = new CheckSection("host");
  static of(raw: string): CheckSection {
    const found = [CheckSection.PI, CheckSection.KMP, CheckSection.MADE, CheckSection.HOST].find((s) => s.value === raw);
    if (!found) throw DomainError.because(`unknown check section ${raw}`);
    return found;
  }
}
```

`src/domain/diagnosis/CheckStatus.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";

export class CheckStatus extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly OK = new CheckStatus("OK");
  static readonly WARN = new CheckStatus("WARN");
  static readonly FAIL = new CheckStatus("FAIL");
}
```

`src/domain/diagnosis/CheckName.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CheckName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CheckName {
    if (!raw.trim()) throw DomainError.because("check name must not be empty");
    return new CheckName(raw);
  }
}
```

`src/domain/diagnosis/CheckDetail.ts`:

```ts
import { ValueObject } from "../shared/ValueObject.ts";

export class CheckDetail extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CheckDetail { return new CheckDetail(raw.replace(/\s+/g, " ").trim()); }
}
```

`src/domain/diagnosis/Check.ts`:

```ts
import type { CheckDetail } from "./CheckDetail.ts";
import type { CheckName } from "./CheckName.ts";
import type { CheckSection } from "./CheckSection.ts";
import { CheckStatus } from "./CheckStatus.ts";

export class Check {
  readonly section: CheckSection; readonly status: CheckStatus; readonly name: CheckName; readonly detail: CheckDetail;
  private constructor(s: CheckSection, st: CheckStatus, n: CheckName, d: CheckDetail) { this.section = s; this.status = st; this.name = n; this.detail = d; }
  static ok(s: CheckSection, n: CheckName, d: CheckDetail): Check { return new Check(s, CheckStatus.OK, n, d); }
  static warn(s: CheckSection, n: CheckName, d: CheckDetail): Check { return new Check(s, CheckStatus.WARN, n, d); }
  static fail(s: CheckSection, n: CheckName, d: CheckDetail): Check { return new Check(s, CheckStatus.FAIL, n, d); }
}
```

`src/domain/diagnosis/DiagnosisReport.ts`:

```ts
import type { Check } from "./Check.ts";
import type { CheckSection } from "./CheckSection.ts";
import { CheckStatus } from "./CheckStatus.ts";

export class DiagnosisReport {
  readonly #checks: Check[];
  private constructor(c: Check[]) { this.#checks = c; }
  static of(checks: Check[]): DiagnosisReport { return new DiagnosisReport([...checks]); }
  add(...more: Check[]): DiagnosisReport { return new DiagnosisReport([...this.#checks, ...more]); }
  merge(other: DiagnosisReport): DiagnosisReport { return this.add(...other.checks()); }
  hasFailures(): boolean { return this.#checks.some((c) => c.status.equals(CheckStatus.FAIL)); }
  checks(): Check[] { return [...this.#checks]; }
  sections(): CheckSection[] {
    const out: CheckSection[] = [];
    for (const c of this.#checks) if (!out.some((s) => s.equals(c.section))) out.push(c.section);
    return out;
  }
}
```

`src/domain/diagnosis/FingerprintDrift.ts`:

```ts
import type { CatalogFingerprint } from "../mcp/CatalogFingerprint.ts";
import { Check } from "./Check.ts";
import { CheckDetail } from "./CheckDetail.ts";
import { CheckName } from "./CheckName.ts";
import { CheckSection } from "./CheckSection.ts";

export class FingerprintDrift {
  private constructor() {}
  static compare(previous: Map<string, CatalogFingerprint>, current: Map<string, CatalogFingerprint>): Check[] {
    const name = CheckName.of("catalog fingerprint");
    return [...current.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([server, fp]) => {
      const section = CheckSection.of(server);
      const before = previous.get(server);
      if (!before) return Check.ok(section, name, CheckDetail.of(`recorded ${fp.short()}`));
      if (before.equals(fp)) return Check.ok(section, name, CheckDetail.of(`unchanged ${fp.short()}`));
      return Check.warn(section, name, CheckDetail.of(`changed ${before.short()} → ${fp.short()}; review profiles before trusting new tools`));
    });
  }
}
```

- [ ] **Step 4: Implementar aplicación y adaptadores**

`src/application/ports/AuthorizationBootstrapper.ts`:

```ts
import type { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";

export interface AuthorizationBootstrapper { bootstrap(store: StorePath, config: MadeConfiguration): Promise<string>; }
```

`src/application/ports/KmpLifecycle.ts`:

```ts
export interface KmpLifecycle { setup(): Promise<void>; doctor(): Promise<boolean>; }
```

`src/application/ports/PiPackageManager.ts`:

```ts
export interface PiPackageManager { install(packageDir: string): Promise<void>; isRegistered(packageName: string): Promise<boolean>; }
```

`src/application/ports/PiRuntimeInspector.ts`:

```ts
import type { SemVer } from "../../domain/distribution/SemVer.ts";

export interface PiRuntimeInspector { version(): Promise<SemVer | null>; }
```

`src/application/ports/FingerprintRepository.ts`:

```ts
import type { CatalogFingerprint } from "../../domain/mcp/CatalogFingerprint.ts";

export interface FingerprintRepository { load(): Map<string, CatalogFingerprint>; save(fingerprints: Map<string, CatalogFingerprint>): void; }
```

`src/application/dto/CheckDto.ts`:

```ts
export type CheckDto = { section: string; status: string; name: string; detail: string };
```

`src/application/mappers/CheckMapper.ts`:

```ts
import type { Check } from "../../domain/diagnosis/Check.ts";
import type { CheckDto } from "../dto/CheckDto.ts";

export class CheckMapper {
  toDto(c: Check): CheckDto { return { section: c.section.value, status: c.status.value, name: c.name.value, detail: c.detail.value }; }
}
```

`src/application/use-cases/BootstrapMadeAuthorization.ts`:

```ts
import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import type { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import type { AuthorizationBootstrapper } from "../ports/AuthorizationBootstrapper.ts";

export class BootstrapMadeAuthorization {
  readonly #bootstrapper: AuthorizationBootstrapper;
  constructor(b: AuthorizationBootstrapper) { this.#bootstrapper = b; }
  async execute(store: StorePath, config: MadeConfiguration): Promise<Check> {
    const name = CheckName.of("authorization bootstrap");
    try { return Check.ok(CheckSection.MADE, name, CheckDetail.of(await this.#bootstrapper.bootstrap(store, config))); }
    catch (e) { return Check.fail(CheckSection.MADE, name, CheckDetail.of((e as Error).message)); }
  }
}
```

`src/application/use-cases/DiscoverMadeCapabilities.ts`:

```ts
import { DomainError } from "../../domain/shared/DomainError.ts";
import type { MadeCapabilities } from "../../domain/made/MadeCapabilities.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { MadeCapabilitiesDto } from "../dto/MadeCapabilitiesDto.ts";
import { MadeCapabilitiesMapper } from "../mappers/MadeCapabilitiesMapper.ts";
import type { McpConnection } from "../ports/McpConnection.ts";

export class DiscoverMadeCapabilities {
  async execute(connection: McpConnection): Promise<MadeCapabilities> {
    const outcome = await connection.call(ToolName.of("made_discover_capabilities"), {});
    if (outcome instanceof ToolRefusal) throw DomainError.because(`made_discover_capabilities refused: ${outcome.describe()}`);
    return new MadeCapabilitiesMapper().toDomain(outcome.structured as MadeCapabilitiesDto);
  }
}
```

`src/application/use-cases/SetupInstallation.ts`:

```ts
import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import { DiagnosisReport } from "../../domain/diagnosis/DiagnosisReport.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import type { KmpLifecycle } from "../ports/KmpLifecycle.ts";
import type { PiPackageManager } from "../ports/PiPackageManager.ts";
import type { BootstrapMadeAuthorization } from "./BootstrapMadeAuthorization.ts";
import type { EnsureMadeConfiguration } from "./EnsureMadeConfiguration.ts";
import type { InstallPinnedBinaries } from "./InstallPinnedBinaries.ts";

const step = async (section: CheckSection, name: string, run: () => Promise<string>): Promise<Check> => {
  try { return Check.ok(section, CheckName.of(name), CheckDetail.of(await run())); }
  catch (e) { return Check.fail(section, CheckName.of(name), CheckDetail.of((e as Error).message)); }
};

export class SetupInstallation {
  readonly #install: InstallPinnedBinaries; readonly #ensure: EnsureMadeConfiguration; readonly #bootstrap: BootstrapMadeAuthorization;
  readonly #kmp: KmpLifecycle; readonly #pi: PiPackageManager; readonly #store: StorePath; readonly #packageDir: string;

  constructor(install: InstallPinnedBinaries, ensure: EnsureMadeConfiguration, bootstrap: BootstrapMadeAuthorization, kmp: KmpLifecycle, pi: PiPackageManager, store: StorePath, packageDir: string) {
    this.#install = install; this.#ensure = ensure; this.#bootstrap = bootstrap; this.#kmp = kmp; this.#pi = pi; this.#store = store; this.#packageDir = packageDir;
  }

  async execute(): Promise<DiagnosisReport> {
    const binaries = await step(CheckSection.HOST, "pinned binaries", async () => (await this.#install.execute()).map((r) => `${r.name} ${r.action}`).join(", ") || "none");
    let report = DiagnosisReport.of([binaries]);
    if (report.hasFailures()) return report;
    const ensured = this.#ensure.execute(this.#store);
    report = report.add(Check.ok(CheckSection.MADE, CheckName.of("private configuration"), CheckDetail.of(`${ensured.created ? "created" : "reused"} ${ensured.location} (key redacted)`)));
    report = report.add(await this.#bootstrap.execute(this.#store, ensured.configuration));
    report = report.add(await step(CheckSection.KMP, "kmp-mcp setup", async () => { await this.#kmp.setup(); return "receipt ok"; }));
    return report.add(await step(CheckSection.PI, "underpass-pi package", async () => { await this.#pi.install(this.#packageDir); return `pi install ${this.#packageDir}`; }));
  }
}
```

`src/application/use-cases/DiagnoseInstallation.ts`:

```ts
import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import { DiagnosisReport } from "../../domain/diagnosis/DiagnosisReport.ts";
import { FingerprintDrift } from "../../domain/diagnosis/FingerprintDrift.ts";
import type { SemVer } from "../../domain/distribution/SemVer.ts";
import { DeclaredLimitId } from "../../domain/made/DeclaredLimitId.ts";
import type { CatalogFingerprint } from "../../domain/mcp/CatalogFingerprint.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
import type { FingerprintRepository } from "../ports/FingerprintRepository.ts";
import type { KmpLifecycle } from "../ports/KmpLifecycle.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import type { PiPackageManager } from "../ports/PiPackageManager.ts";
import type { PiRuntimeInspector } from "../ports/PiRuntimeInspector.ts";
import type { DiscoverMadeCapabilities } from "./DiscoverMadeCapabilities.ts";
import type { InstallPinnedBinaries } from "./InstallPinnedBinaries.ts";
import type { VerifyServerProfiles } from "./VerifyServerProfiles.ts";

const c = (s: CheckSection, n: string, d: string) => ({ s, n: CheckName.of(n), d: CheckDetail.of(d) });

export class DiagnoseInstallation {
  readonly #install: InstallPinnedBinaries; readonly #runtime: PiRuntimeInspector; readonly #pi: PiPackageManager; readonly #kmp: KmpLifecycle;
  readonly #fingerprints: FingerprintRepository; readonly #connect: (s: ServerName) => Promise<McpConnection>;
  readonly #profiles: VerifyServerProfiles; readonly #capabilities: DiscoverMadeCapabilities; readonly #piVersion: SemVer;

  constructor(install: InstallPinnedBinaries, runtime: PiRuntimeInspector, pi: PiPackageManager, kmp: KmpLifecycle, fingerprints: FingerprintRepository,
    connect: (s: ServerName) => Promise<McpConnection>, profiles: VerifyServerProfiles, capabilities: DiscoverMadeCapabilities, piVersion: SemVer) {
    this.#install = install; this.#runtime = runtime; this.#pi = pi; this.#kmp = kmp; this.#fingerprints = fingerprints;
    this.#connect = connect; this.#profiles = profiles; this.#capabilities = capabilities; this.#piVersion = piVersion;
  }

  async execute(record: boolean): Promise<DiagnosisReport> {
    let report = DiagnosisReport.of(await this.#piChecks());
    try { await this.#install.execute(); report = report.add(Check.ok(CheckSection.HOST, CheckName.of("pinned binaries"), CheckDetail.of("verified"))); }
    catch (e) { return report.add(Check.fail(CheckSection.HOST, CheckName.of("pinned binaries"), CheckDetail.of((e as Error).message))); }

    const current = new Map<string, CatalogFingerprint>();
    for (const server of [ServerName.KMP, ServerName.MADE]) {
      const conn = await this.#connect(server);
      try {
        const catalog = await conn.catalog();
        current.set(server.value, catalog.fingerprint());
        for (const check of this.#profiles.execute(catalog)) {
          const x = c(CheckSection.of(server.value), `profile ${check.profile}`, check.isSatisfied() ? `${catalog.identity.version}, ${catalog.names().length} tools` : `missing ${check.missing().join(", ")}`);
          report = report.add(check.isSatisfied() ? Check.ok(x.s, x.n, x.d) : Check.fail(x.s, x.n, x.d));
        }
        if (server.equals(ServerName.MADE)) {
          const caps = await this.#capabilities.execute(conn);
          const x = c(CheckSection.MADE, "capabilities", `groups ${caps.groups.length}; limits ${caps.limits.join(", ")}`);
          report = report.add(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL) ? Check.ok(x.s, x.n, x.d) : Check.warn(x.s, x.n, x.d));
        }
      } finally { await conn.close(); }
    }
    report = report.add(...FingerprintDrift.compare(this.#fingerprints.load(), current));
    if (record) this.#fingerprints.save(current);
    const healthy = await this.#kmp.doctor();
    const k = c(CheckSection.KMP, "kmp-mcp doctor", healthy ? "no FAIL" : "reported problems; run kmp-mcp doctor");
    return report.add(healthy ? Check.ok(k.s, k.n, k.d) : Check.warn(k.s, k.n, k.d));
  }

  async #piChecks(): Promise<Check[]> {
    const v = await this.#runtime.version();
    const version = !v
      ? Check.fail(CheckSection.PI, CheckName.of("pi version"), CheckDetail.of("pi not found; run scripts/install-pi.sh"))
      : v.equals(this.#piVersion)
        ? Check.ok(CheckSection.PI, CheckName.of("pi version"), CheckDetail.of(v.value))
        : Check.fail(CheckSection.PI, CheckName.of("pi version"), CheckDetail.of(`${v} (pinned ${this.#piVersion})`));
    const registered = await this.#pi.isRegistered("underpass-pi");
    const pkg = registered
      ? Check.ok(CheckSection.PI, CheckName.of("underpass-pi package"), CheckDetail.of("registered"))
      : Check.fail(CheckSection.PI, CheckName.of("underpass-pi package"), CheckDetail.of("not registered; run underpass setup"));
    return [version, pkg];
  }
}
```

`src/adapters/outbound/process/MadeCliAuthorizationBootstrapper.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AuthorizationBootstrapper } from "../../../application/ports/AuthorizationBootstrapper.ts";
import type { MadeConfiguration } from "../../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";

export class MadeCliAuthorizationBootstrapper implements AuthorizationBootstrapper {
  readonly #binary: string;
  constructor(binary: string) { this.#binary = binary; }
  async bootstrap(store: StorePath, config: MadeConfiguration): Promise<string> {
    try {
      const { stdout } = await promisify(execFile)(this.#binary, ["bootstrap-authorization", store.value, "--policy-id", config.policy.value, "--trusted-host-id", config.trustedHost.value]);
      return stdout.trim();
    } catch (e) { throw new Error(String((e as { stderr?: string }).stderr || (e as Error).message).trim()); }
  }
}
```

`src/adapters/outbound/process/KmpCliLifecycle.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { KmpLifecycle } from "../../../application/ports/KmpLifecycle.ts";

export class KmpCliLifecycle implements KmpLifecycle {
  readonly #binary: string; readonly #engineDir: string; readonly #env: Record<string, string | undefined>;
  constructor(binary: string, engineDir: string, env: Record<string, string | undefined>) { this.#binary = binary; this.#engineDir = engineDir; this.#env = env; }
  async setup(): Promise<void> { await promisify(execFile)(this.#binary, ["setup", "--engine-dir", this.#engineDir], { env: { ...process.env, ...this.#env } }); }
  async doctor(): Promise<boolean> {
    try { await promisify(execFile)(this.#binary, ["doctor"], { env: { ...process.env, ...this.#env } }); return true; } catch { return false; }
  }
}
```

`src/adapters/outbound/process/PiCliPackageManager.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PiPackageManager } from "../../../application/ports/PiPackageManager.ts";

export class PiCliPackageManager implements PiPackageManager {
  readonly #pi: string;
  constructor(pi = "pi") { this.#pi = pi; }
  async install(packageDir: string): Promise<void> { await promisify(execFile)(this.#pi, ["install", packageDir]); }
  async isRegistered(packageName: string): Promise<boolean> {
    try { return (await promisify(execFile)(this.#pi, ["list"])).stdout.includes(packageName); } catch { return false; }
  }
}
```

`src/adapters/outbound/process/PiCliRuntimeInspector.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PiRuntimeInspector } from "../../../application/ports/PiRuntimeInspector.ts";
import { SemVer } from "../../../domain/distribution/SemVer.ts";

export class PiCliRuntimeInspector implements PiRuntimeInspector {
  readonly #pi: string;
  constructor(pi = "pi") { this.#pi = pi; }
  async version(): Promise<SemVer | null> {
    try {
      const m = (await promisify(execFile)(this.#pi, ["--version"])).stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
      return m ? SemVer.of(m[0]) : null;
    } catch { return null; }
  }
}
```

`src/adapters/outbound/fs/FsFingerprintRepository.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FingerprintRepository } from "../../../application/ports/FingerprintRepository.ts";
import { CatalogFingerprint } from "../../../domain/mcp/CatalogFingerprint.ts";

export class FsFingerprintRepository implements FingerprintRepository {
  readonly #file: string;
  constructor(file: string) { this.#file = file; }
  load(): Map<string, CatalogFingerprint> {
    if (!existsSync(this.#file)) return new Map();
    return new Map(Object.entries(JSON.parse(readFileSync(this.#file, "utf8")) as Record<string, string>).map(([k, v]) => [k, CatalogFingerprint.of(v)]));
  }
  save(m: Map<string, CatalogFingerprint>): void {
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, JSON.stringify(Object.fromEntries([...m].map(([k, v]) => [k, v.value])), null, 2));
  }
}
```

`src/adapters/inbound/cli/CheckRenderer.ts`:

```ts
import type { CheckDto } from "../../../application/dto/CheckDto.ts";

export class CheckRenderer {
  render(checks: CheckDto[]): string {
    const sections = [...new Set(checks.map((c) => c.section))];
    return sections.map((s) => [`[${s}]`, ...checks.filter((c) => c.section === s).map((c) => `  ${c.status.padEnd(4)} ${c.name} — ${c.detail}`)].join("\n")).join("\n");
  }
}
```

`src/adapters/inbound/cli/UnderpassCli.ts`:

```ts
import { CheckMapper } from "../../../application/mappers/CheckMapper.ts";
import type { DiagnosisReport } from "../../../domain/diagnosis/DiagnosisReport.ts";
import { CheckRenderer } from "./CheckRenderer.ts";

type Runs = { execute(record?: boolean): Promise<DiagnosisReport> };

export class UnderpassCli {
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void) { this.#setup = setup; this.#doctor = doctor; this.#print = print; }

  async run(argv: string[]): Promise<number> {
    const verb = argv[0];
    let report: DiagnosisReport;
    if (verb === "setup") report = (await this.#setup.execute()).merge(await this.#doctor.execute(true));
    else if (verb === "update") report = (await this.#setup.execute()).merge(await this.#doctor.execute(false));
    else if (verb === "doctor") report = await this.#doctor.execute(false);
    else { this.#print("usage: underpass setup | doctor | update"); return 2; }
    const mapper = new CheckMapper();
    this.#print(new CheckRenderer().render(report.checks().map((c) => mapper.toDto(c))));
    return report.hasFailures() ? 1 : 0;
  }
}
```

`src/composition/CliComposition.ts`:

```ts
import { join } from "node:path";
import { NodeEntropySource } from "../adapters/outbound/crypto/NodeEntropySource.ts";
import { FsBinaryInstallation } from "../adapters/outbound/fs/FsBinaryInstallation.ts";
import { FsFingerprintRepository } from "../adapters/outbound/fs/FsFingerprintRepository.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { NodeFileDigester } from "../adapters/outbound/fs/NodeFileDigester.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { GithubReleaseDownloader } from "../adapters/outbound/github/GithubReleaseDownloader.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { KmpCliLifecycle } from "../adapters/outbound/process/KmpCliLifecycle.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeCliAuthorizationBootstrapper } from "../adapters/outbound/process/MadeCliAuthorizationBootstrapper.ts";
import { MadeServerCommandFactory } from "../adapters/outbound/process/MadeServerCommandFactory.ts";
import { PiCliPackageManager } from "../adapters/outbound/process/PiCliPackageManager.ts";
import { PiCliRuntimeInspector } from "../adapters/outbound/process/PiCliRuntimeInspector.ts";
import { UnderpassCli } from "../adapters/inbound/cli/UnderpassCli.ts";
import { BootstrapMadeAuthorization } from "../application/use-cases/BootstrapMadeAuthorization.ts";
import { DiagnoseInstallation } from "../application/use-cases/DiagnoseInstallation.ts";
import { DiscoverMadeCapabilities } from "../application/use-cases/DiscoverMadeCapabilities.ts";
import { EnsureMadeConfiguration } from "../application/use-cases/EnsureMadeConfiguration.ts";
import { InstallPinnedBinaries } from "../application/use-cases/InstallPinnedBinaries.ts";
import { SetupInstallation } from "../application/use-cases/SetupInstallation.ts";
import { VerifyServerProfiles } from "../application/use-cases/VerifyServerProfiles.ts";
import { ToolProfiles } from "../domain/contracts/ToolProfiles.ts";
import { BinaryName } from "../domain/distribution/BinaryName.ts";
import { Target } from "../domain/distribution/Target.ts";
import { StorePath } from "../domain/made/StorePath.ts";
import { ServerName } from "../domain/mcp/ServerName.ts";
import { StatePaths } from "./StatePaths.ts";

export class CliComposition {
  static build(env: Record<string, string | undefined>, print: (s: string) => void): UnderpassCli {
    const repoRoot = new URL("../../", import.meta.url).pathname;
    const paths = new StatePaths(env);
    const pins = new JsonPinSetSource(join(repoRoot, "pins.json")).load();
    const installation = new FsBinaryInstallation(paths.binDir());
    const install = new InstallPinnedBinaries(pins, Target.detect(process.platform, process.arch), new GithubReleaseDownloader(), new NodeFileDigester(), installation);
    const kmpBin = installation.pathOf(pins.pinFor(BinaryName.KMP));
    const madeBin = installation.pathOf(pins.pinFor(BinaryName.MADE));
    const store = StorePath.of(env.MADE_MCP_STORE_PATH ?? join(env.XDG_STATE_HOME ?? join(env.HOME ?? "", ".local/state"), "underpass-made", "ceremonies.sqlite3"));
    const configs = new FsMadeConfigurationRepository(env);
    const ensure = new EnsureMadeConfiguration(configs, new NodeEntropySource());
    const kmp = new KmpCliLifecycle(kmpBin, paths.binDir(), env);
    const piPackages = new PiCliPackageManager();
    const project = new GitProjectLocator().locate(process.cwd());
    const connector = new StdioMcpConnector(60_000);
    const connect = (s: ServerName) => s.equals(ServerName.KMP)
      ? connector.open(s, new KmpServerCommandFactory(kmpBin, env).commandFor(project))
      : connector.open(s, new MadeServerCommandFactory(madeBin, store, ensure.execute(store).configuration, env).commandFor(project));

    const setup = new SetupInstallation(install, ensure, new BootstrapMadeAuthorization(new MadeCliAuthorizationBootstrapper(madeBin)), kmp, piPackages, store, repoRoot);
    const doctor = new DiagnoseInstallation(install, new PiCliRuntimeInspector(), piPackages, kmp, new FsFingerprintRepository(paths.fingerprintsFile()),
      connect, new VerifyServerProfiles(ToolProfiles.standard()), new DiscoverMadeCapabilities(), pins.pi.version);
    return new UnderpassCli(setup, doctor, print);
  }
}
```

`bin/underpass.ts`:

```ts
#!/usr/bin/env node
import { CliComposition } from "../src/composition/CliComposition.ts";

process.exit(await CliComposition.build(process.env, (s) => console.log(s)).run(process.argv.slice(2)));
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npm test`
Expected: PASS, cobertura ≥ 80 %, arquitectura en verde. Si `CliComposition` no llega al 80 %, se añade `tests/unit/composition/CliComposition.test.ts`: construye el CLI con un `HOME` temporal, ejecuta `run(["nope"])` y espera exit 2. Así se ejercita el cableado sin red.

- [ ] **Step 6: Commit**

```bash
git add src bin/underpass.ts tests
git commit -m "feat(cli): setup, doctor y update como casos de uso con diagnóstico de dominio"
```

---

### Task 13: `Host::Pi` en KMP (repo `underpass-ai/kmp`, PR propia)

Sin cambios de enfoque respecto a la versión anterior del plan: KMP ya tiene su propio estándar hexagonal y sus gates.

**Files** (en `/home/gx10a/Documents/ai/kmp`, en un worktree `feat/lifecycle-pi-host` creado desde `origin/main`):
- Modify: `crates/kmp-mcp/src/lifecycle/domain/host.rs`: variante `Pi`, `CONVERGENCE_ORDER: [Self; 4] = [Claude, Codex, Hermes, Pi]`, `executable()` → `"pi"`, `Display` → `"pi"`, tests
- Modify: `crates/kmp-mcp/src/lifecycle/adapters/lifecycle_cli_parser.rs:24`: `"--pi" => hosts.push("pi")`
- Modify: `crates/kmp-mcp/src/lifecycle/application/mappers/lifecycle_command_mapper.rs:28`: `"pi" => Ok(Host::Pi)`
- Create: `crates/kmp-mcp/src/lifecycle/adapters/pi_host_adapter.rs`, `crates/kmp-mcp/src/lifecycle/adapters/mappers/pi_runtime_status_mapper.rs`, `crates/kmp-mcp/src/lifecycle/domain/pi_agent_home.rs` (con sus `mod.rs`)
- Modify: `crates/kmp-mcp/src/lifecycle/adapters/native_host_gateway.rs`: campo `pi: Option<PiHostAdapter>` y todos los `match Host` (`inventory_host`, `refresh`, `provision`, `runtime_status`, `runtime_engine`)
- Modify: `crates/kmp-mcp/src/cli/mod.rs:85,155-162`: ayuda `[--claude] [--codex] [--hermes] [--pi]`
- Modify: `plugins/kmp/README.md:105-118`: corrige `--host hermes`, que no existe, y documenta `--hermes` y `--pi`
- Test: `crates/kmp-mcp/tests/{lifecycle_native_hosts,lifecycle_update,lifecycle_diagnosis}.rs`, `crates/kmp-mcp/tests/lifecycle_support/{fake_host_gateway,fake_engine_store}.rs`

**Contrato del host Pi** (Pi no tiene MCP nativo):
- **Evidencia de registro:** `<home>/settings.json`, clave `packages`, con una entrada (string u objeto `{source}`) que termine en `underpass-pi`. Si falta → `Missing`. Si está presente pero con el filtro `extensions` que incluye `!src/adapters/inbound/pi/entry/kmp.ts` → `Disabled`. Si está presente → `Registered`. Si el JSON es ilegible → `Failed`.
- **Home:** `$PI_CODING_AGENT_DIR` si está definido, si no `$HOME/.pi/agent`. Las skills van en `<home>/skills/<name>/`.
- **`provision()`:** replica las skills con la lista compartida `NATIVE_SKILL_NAMES`, que es la actual `HERMES_SKILL_NAMES` renombrada. No instala el paquete: de eso se encarga `underpass setup`. Sin registro, el aviso incluye `underpass setup`.
- **`installs_plugin_tree()` y `owns_plugin_engine()`:** `false` los dos. `runtime_engine` resuelve `kmp-mcp` en PATH.

- [ ] **Step 1: Worktree y plantilla**

```bash
cd /home/gx10a/Documents/ai/kmp && git fetch -q origin && git worktree add -b feat/lifecycle-pi-host ../kmp-wt-pi-host origin/main
cd ../kmp-wt-pi-host && git show --stat e7d9af51 719ed5b2
```

Expected: los 22 ficheros de #830/#831 y la paridad de #849/#851. Cada `match Host` que tocó Hermes necesita su brazo `Pi`.

- [ ] **Step 2: Tests de dominio que fallan** en `host.rs`

```rust
#[test]
fn pi_is_the_last_peer_in_convergence_order() {
    assert_eq!(Host::CONVERGENCE_ORDER, [Host::Claude, Host::Codex, Host::Hermes, Host::Pi]);
}

#[test]
fn pi_declares_its_own_executable_name() {
    assert_eq!(Host::Pi.executable(), "pi");
    assert_eq!(Host::Pi.to_string(), "pi");
}

#[test]
fn pi_neither_owns_a_plugin_engine_nor_installs_a_plugin_tree() {
    assert!(!Host::Pi.owns_plugin_engine());
    assert!(!Host::Pi.installs_plugin_tree());
}
```

Run: `cargo test -p kmp-mcp --lib lifecycle::domain::host`
Expected: FAIL, `no variant named Pi`

- [ ] **Step 3: Variante y brazos `match`** hasta que `cargo build -p kmp-mcp` compile; el compilador señala cada `match` incompleto.

Run: `cargo test -p kmp-mcp --lib lifecycle::domain::host`
Expected: PASS

- [ ] **Step 4: Mapeador de estado**, con tests en `pi_runtime_status_mapper.rs`

```rust
#[test]
fn absent_settings_is_missing() { assert_eq!(map_pi_settings(None), HostRuntimeStatus::Missing); }

#[test]
fn underpass_package_string_is_registered() {
    assert_eq!(map_pi_settings(Some(r#"{"packages":["/home/u/Documents/ai/underpass-pi"]}"#)), HostRuntimeStatus::Registered);
}

#[test]
fn underpass_package_excluding_the_kmp_extension_is_disabled() {
    let s = r#"{"packages":[{"source":"git:github.com/underpass-ai/underpass-pi@v0.1.0","extensions":["!src/adapters/inbound/pi/entry/kmp.ts"]}]}"#;
    assert_eq!(map_pi_settings(Some(s)), HostRuntimeStatus::Disabled);
}

#[test]
fn unreadable_settings_is_failed() { assert_eq!(map_pi_settings(Some("{not json")), HostRuntimeStatus::Failed); }

#[test]
fn foreign_packages_only_is_missing() {
    assert_eq!(map_pi_settings(Some(r#"{"packages":["npm:pi-mcp-adapter"]}"#)), HostRuntimeStatus::Missing);
}
```

Implementación. Si las variantes reales de `HostRuntimeStatus` en `domain/host_runtime_status.rs` se llaman de otra forma, se usan esas; el mapeador de Hermes (`hermes_runtime_status_mapper.rs:15-38`) cubre los mismos cuatro estados.

```rust
use serde_json::Value;
use crate::lifecycle::domain::host_runtime_status::HostRuntimeStatus;

const PACKAGE_SUFFIX: &str = "underpass-pi";
const KMP_EXTENSION: &str = "src/adapters/inbound/pi/entry/kmp.ts";

pub fn map_pi_settings(settings: Option<&str>) -> HostRuntimeStatus {
    let Some(raw) = settings else { return HostRuntimeStatus::Missing };
    let Ok(json) = serde_json::from_str::<Value>(raw) else { return HostRuntimeStatus::Failed };
    for entry in json.get("packages").and_then(Value::as_array).cloned().unwrap_or_default() {
        let (source, filters) = match &entry {
            Value::String(s) => (s.clone(), Vec::new()),
            Value::Object(o) => (
                o.get("source").and_then(Value::as_str).unwrap_or_default().to_owned(),
                o.get("extensions").and_then(Value::as_array).cloned().unwrap_or_default(),
            ),
            _ => continue,
        };
        let base = source.trim_end_matches('/').split('@').next().unwrap_or_default().to_owned();
        if !(base.ends_with(PACKAGE_SUFFIX) || source.trim_end_matches('/').ends_with(PACKAGE_SUFFIX)) { continue; }
        let excluded = filters.iter().filter_map(Value::as_str).any(|f| f == format!("!{KMP_EXTENSION}"));
        return if excluded { HostRuntimeStatus::Disabled } else { HostRuntimeStatus::Registered };
    }
    HostRuntimeStatus::Missing
}
```

Run: `cargo test -p kmp-mcp --lib pi_runtime_status_mapper`
Expected: PASS (5 tests)

- [ ] **Step 5: `PiHostAdapter`**, con la forma de `hermes_host_adapter.rs`. `PiAgentHome` es un VO de dominio, igual que `HermesSkillDir`. Tests en el propio fichero, con un home temporal:
  - `an_unconfigured_pi_declares_no_installation`
  - `a_registered_underpass_package_is_an_installation`
  - `mirroring_brings_the_plugin_skills_where_pi_scans`
  - `provision_without_registration_points_to_underpass_setup`

  Cada uno replica la estructura del test homónimo de Hermes (`hermes_host_adapter.rs:311-437`), cambiando `.hermes` por `.pi/agent` y la evidencia YAML por `settings.json`.

  Run: `cargo test -p kmp-mcp --lib pi_host_adapter`
  Expected: PASS (4 tests)

- [ ] **Step 6: Integración.** Se añaden:
  - `pi_convergence_mirrors_skills_and_reports_registration` y `setup_without_underpass_package_warns_to_run_underpass_setup` en `lifecycle_native_hosts.rs`;
  - `a_pi_only_update_claims_no_marketplace_tree` en `lifecycle_update.rs`;
  - Pi en `three_host_machine` (renombrado `native_host_machine`), `fake_host_gateway.rs` y `fake_engine_store.rs`.

  Run: `cargo test -p kmp-mcp --test lifecycle_native_hosts --test lifecycle_update --test lifecycle_diagnosis`
  Expected: PASS

- [ ] **Step 7: Gates locales de KMP**: arquitectura de `kmp-mcp` (600 líneas y un tipo principal por fichero), registro MCP, espina documental y capacidades.

```bash
cargo fmt --all -- --check && cargo clippy -p kmp-mcp --all-targets -- -D warnings && cargo test -p kmp-mcp
```

Se ejecutan también los gates de arquitectura del repo (`Makefile` / `.github/workflows/quality-gate.yml`). Expected: todo en verde.

- [ ] **Step 8: PR**

```bash
git add -A && git commit -m "feat(lifecycle): Pi como cuarto host nativo (skills + registro vía underpass-pi)"
git push -u origin feat/lifecycle-pi-host
gh pr create -R underpass-ai/kmp --base main --title "feat(lifecycle): Pi as a native host" \
  --body "Adds Host::Pi (setup/update --pi, doctor, skills mirroring). Registration evidence comes from ~/.pi/agent/settings.json (the underpass-pi package), since Pi has no native MCP. Also fixes --hermes missing from CLI help and the non-existent --host flag in the plugin README."
```

- [ ] **Step 9:** Tras el merge y la release de KMP, en `underpass-pi` se sube el pin de `kmp-mcp` y `KmpCliLifecycle.setup()` pasa a añadir `--pi`. Es un commit aparte (`feat(dist): kmp-mcp <ver> con --pi`) con los sha256 nuevos y su test.

---

### Task 14: Aceptación de extremo a extremo de S1

**Files:**
- Create: `docs/acceptance/s1.md`

- [ ] **Step 1: Instalación limpia**

```bash
bash scripts/install-pi.sh
node bin/underpass.ts setup
node bin/underpass.ts doctor
```

Expected: `pi --version` = 0.87.1, auditoría OSV limpia y `setup`/`doctor` con exit 0. `private configuration: reused` si el plugin de MADE ya había configurado ese store; en ningún caso se toca el store.

- [ ] **Step 2: Carga real por el SDK**

Run: `node tests/acceptance/load-extensions.ts /home/gx10a/Documents/ai/kmp`
Expected: exit 0 y los cuatro `checks` a `true`.

- [ ] **Step 3: `pi` interactivo**

Abrir `pi` en `/home/gx10a/Documents/ai/kmp` y ejecutar `/underpass-status`.
Expected: `project: /home/gx10a/Documents/ai/kmp` y, con cualquier llamada ya hecha, cada servidor con su versión, su recuento y su huella. Una segunda ventana `pi` en un subdirectorio del mismo repo debe ver el mismo proyecto, y `pgrep -af underpass-host` debe mostrar **un único** proceso para ese proyecto.

- [ ] **Step 4: Cierre**

Cerrar ambas ventanas y esperar 60 s.
Expected: el host, `kmp-mcp` y `made-mcp` de ese proyecto terminan, y `host.lock` y `host.sock` desaparecen de `~/.local/state/underpass-pi/projects/<id>/`.

- [ ] **Step 5: Registrar el resultado** en `docs/acceptance/s1.md`: comandos, salidas relevantes sin secretos, fecha y versiones.

```bash
git add docs/acceptance/s1.md
git commit -m "docs(s1): aceptación verificada en la instalación real"
```

---

## Cobertura de la spec

| Spec | Tareas |
|---|---|
| §1 versiones y MADE 0.8.0 | 1, 8 (+ underpass-ai/made#249 para el plugin de Claude) |
| §2 S1 paquete, binarios fijados, setup/doctor/update | 1, 2, 3, 11, 12 |
| §2 S1 `Host::Pi` en KMP | 13 |
| §2 S1 bootstrap de autorización de MADE | 7, 12 |
| §2 S1 catálogo de tools por fase | 11 |
| §2 S1 handshake de capacidades | 4, 6, 8, 12 |
| §3 host determinista, servicio por proyecto, lock, socket restringido | 9, 10 |
| §3 transporte secuencial medido | 8 |
| §8 arranque perezoso, factorías sin recursos | 10, 11 (test `connects === 0` antes de `session_start`) |
| §8 comandos de Pi | 11 (`/underpass-status`, `/underpass-phase`); el resto en S2/S3 |
| §12 P0 contratos | 4, 5, 6, 8 |
| §14 cliente MCP | decidido: adaptador propio (Task 5) |
| Estándar de código (hexagonal, DDD, uno por fichero, 80 %) | 0 (gates), y todas las tareas los cumplen |
