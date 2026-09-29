# Aceptación S3a — autorización de MADE en la instalación real (Task 13)

Fecha: 2026-09-29. Máquina real del usuario, sin contenedores ni mocks del
producto: sesiones reales de Pi por el SDK, host real del proyecto y los
binarios fijados de `kmp-mcp` y `made-mcp`. El modelo es el proveedor `faux` de
pi-ai (respuestas guionizadas, sin red), como en E1, O1 y L1.

Versiones: pi-runtime `feat/s3a-made-auth` (producto de `6529bfc`; scripts de
aceptación en `8978e34`), Pi 0.87.1, Node v22.23.2, `kmp-mcp` 0.24.0,
`made-mcp` 0.8.0.

## Cómo se montó

Todo en un proyecto git desechable (`git init` y un commit vacío), con el estado
aislado en directorios temporales cortos (`0700`; el scratchpad de la sesión es
demasiado largo para el socket Unix del host):

| Variable | Qué aísla |
|---|---|
| `XDG_STATE_HOME=<tmp>/s3s` | log de eventos, socket, spool y huellas de catálogo del proyecto |
| `MADE_MCP_STORE_PATH=<tmp>/s3s/underpass-made/ceremonies.sqlite3` | el store de MADE (el mismo que resolvería `XDG_STATE_HOME`, fijado explícito) |
| `MADE_SETUP_CONFIG_ROOT=<tmp>/s3acc/madecfg` | configuración privada de MADE para ese store |
| `KMP_MCP_DATA_DIR=<tmp>/s3acc/kmp` | memoria de KMP: un store vacío |

No se tocó el store real de MADE, su configuración, `~/.pi/agent/settings.json`
ni el log de kmp, y no se ejecutó `underpass update`. Comprobado después: el
store real no contiene ni los nombres de definición ni los ids de grant de esta
aceptación (el store temporal sí); sus escrituras de esa hora son de los
`made-mcp` 0.7.0 del plugin de Claude, que lo tienen abierto.

Pi carga `pi-runtime` desde el checkout principal, así que:

1. Ningún host ni sesión de Pi abiertos (`pgrep -af 'underpass-host[.]ts'`
   vacío). El checkout principal estaba limpio en `main` (`e55b26f`).
2. `git -C <checkout principal> checkout --detach 8978e34` y todo (CLI y
   scripts) se ejecutó desde ese checkout.
3. `node tests/acceptance/made-config.ts` sembró store y política:

   ```text
   made config created
   authorization bootstrap OK
   ```

4. Al terminar: el host del proyecto temporal parado (por PID; sus `kmp-mcp` y
   `made-mcp` salieron con él), `git checkout main` y `git status --short`
   vacío. El estado temporal se borró.

## `doctor` antes de ninguna sesión

```text
[made-auth]
  OK   host authorization — the host owns the MADE policy and can grant exact actions
  OK   orphan grants — none
  OK   shared store — only pi-runtime's policy
```

El único aviso de todo `doctor` fue `WARN event log — no events recorded yet`;
exit 0, ningún FAIL.

## Sesión con la confirmación aceptada

```bash
S3A_CONFIRM=accept node tests/acceptance/made-auth-session.ts <proj>        # exit 0
```

```text
checks: designed, validated, explained, askedOnce, publish, statusMadeLine, noExtensionErrors — todos true
asked:  MADE: publish_ceremony_definition | definition pr_review_two_reviewers v1.0. Allow this call?
made:   made: 4 active grants · 1 confirmations
tools:  made_design_ceremony:ok made_validate_ceremony_draft:ok made_explain_ceremony_draft:ok made_publish_ceremony_definition:ok
```

Diseñar, validar y explicar no preguntan; publicar pregunta una sola vez y, al
aceptar, publica. Hechos de la sesión (`events show`): tres
`made.grant_issued` `auto` (`design_ceremony` con alcance `global`,
`validate_ceremony_draft` y `explain_ceremony_draft` con alcance de
definición, 12 h), `made.confirmation` con `outcome: accepted` y el
`made.grant_issued` `confirm` de `publish_ceremony_definition` (5 min).

Tras el cierre, `underpass made grants`:

```text
pi-runtime-8328…  revoked  auto     design_ceremony              global
pi-runtime-90aa…  revoked  auto     validate_ceremony_draft      definition pr_review_two_reviewers v1.0
pi-runtime-991f…  revoked  auto     explain_ceremony_draft       definition pr_review_two_reviewers v1.0
pi-runtime-d08a…  revoked  confirm  publish_ceremony_definition  definition pr_review_two_reviewers v1.0
```

## Sesión con la confirmación rechazada

```bash
S3A_CONFIRM=decline node tests/acceptance/made-auth-session.ts <proj> pr_review_declined   # exit 0
```

Todos los checks en `true`; una sola pregunta; `made: 3 active grants · 1 confirmations`;
la publicación vuelve como

```text
made_publish_ceremony_definition refused (needs_confirmation_declined): the user declined MADE publish_ceremony_definition on definition pr_review_declined v1.0
```

`events show <sesión>`: tres `made.grant_issued` y un `made.confirmation` con
`outcome: declined` y `scopeSummary: definition pr_review_declined v1.0`.

## Sesión sin UI

Modo añadido al script del brief (`S3A_CONFIRM=noui`: la sesión se ata sin
`uiContext`, así que `hasUI` es `false`):

```bash
S3A_CONFIRM=noui node tests/acceptance/made-auth-session.ts <proj> pr_review_noui   # exit 0
```

Diseñar, validar y explicar funcionan; no se pregunta nada y la publicación
vuelve como `made_publish_ceremony_definition refused (needs_confirmation_no_ui): …`.
`events show`: tres `made.grant_issued` y un `made.confirmation` con
`outcome: no_ui`. (Sin UI, `/underpass-status` no tiene dónde notificar; la
línea `made:` se comprueba en las dos sesiones con UI.)

## Privacidad de `events show`

En las sesiones rechazada y sin UI (25 líneas cada una), 4 hechos `made.*` y
**0** coincidencias de `instructions`, `Review the change`, `definition_yaml`,
`objective`, `hmac`, rutas de `$HOME` o de `/tmp`: los hechos llevan acción,
clase, id de grant, clase de alcance, nombre/versión de la definición y
caducidad; nunca el YAML, rutas ni secretos.

## `doctor` y huérfanos al final

```text
[made-auth]
  OK   host authorization — the host owns the MADE policy and can grant exact actions
  OK   orphan grants — none
  OK   shared store — only pi-runtime's policy
```

`doctor` exit 0. `underpass made grants`: los 10 grants de las tres sesiones
(3 × `design_ceremony`, 3 × `validate_ceremony_draft`, 3 ×
`explain_ceremony_draft` `auto`, 1 × `publish_ceremony_definition` `confirm`)
en `revoked`. `underpass made revoke-orphans` → `no orphan MADE grants`, exit 0.

## Vistazo de la TUI

No se hizo (paso 7 del brief, opcional y a mano con un modelo real): lo cubren
las sesiones por el SDK de arriba.
