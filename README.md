# Pi Runtime

Underpass's agent runtime, built on [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
(`@earendil-works/pi-coding-agent` 0.87.1, unforked) with two native capabilities
reached over MCP:

- **KMP** (`kmp-mcp`): memory with evidence.
- **MADE** (`made-mcp`): governance of procedures, claims, budget and permissions.

Authority is split, and nothing is decided twice:

| Who | Owns |
|---|---|
| MADE | Decisions: definitions, state, claims, leases, budget, grants, approvals, receipts |
| Pi | Reasoning: the conversation, session tree and compaction |
| KMP | Memory: durable facts, relations, validity, provenance, labels |
| Host | Bridging: one deterministic process per project that runs the MCP servers and hands their tools to Pi. It keeps no state machine, budget or validator of its own, and never decides authorization: MADE does, and the host only asks it for exact, audited grants. |

Formerly `underpass-pi`.

## Status

**S1 (distribution) and P0 (MCP contracts) are done** and accepted on a real
installation ([`docs/acceptance/s1.md`](docs/acceptance/s1.md)):

- A Pi package with three extensions (`host`, `kmp`, `made`). The first time a
  session opens in a project, it lazily starts one host for that project.
  Every Pi window on that project shares it (owner lock, `0600` socket in a
  `0700` directory, shutdown when idle).
- The host runs pinned, sha256-verified `kmp-mcp` 0.24.0 and `made-mcp` 0.8.0
  over persistent stdio MCP. It registers their tools in Pi by phase. MADE
  control verbs are never exposed to the model.
- `underpass setup | doctor | update`. `doctor` only reads.
- Contract findings for both servers are in [`docs/contracts/p0-findings.md`](docs/contracts/p0-findings.md).

Roadmap (not implemented yet, see the [design spec](docs/specs/2026-09-28-pi-runtime-design.md) §2):

| # | Subproject |
|---|---|
| S2 | KMP native in Pi: always-on bounded memory, focused wake, `/catchup /save /restore /revert` |
| S3 | MADE native in Pi: `working_session`, child ceremonies, per-worker grants, budget, approvals in the TUI |
| S5 | MADE→KMP bridge: canonical projection of the MADE journal into KMP |
| S4 | Pi as a MADE agent: councils run on Pi |
| S6 | AEO, Foundry and Signal Studio moved onto the runtime |

`Host::Pi` support in KMP ships separately. Until that KMP release,
`underpass setup` does not run `kmp-mcp setup`.

## Requirements

- Linux (the release pins cover `x86_64` and `aarch64`)
- Node.js ≥ 22.19 (22.x, for native TypeScript type stripping)
- git (a project is identified by its git root)
- npm, only to install Pi itself

## Install

```bash
git clone https://github.com/underpass-ai/pi-runtime.git
cd pi-runtime
scripts/install-pi.sh           # Pi 0.87.1 (see below)
node bin/underpass.ts setup     # pinned binaries, MADE config and authorization, `pi install` of this package
node bin/underpass.ts doctor    # read-only check; exit 0 when everything is OK
```

`scripts/install-pi.sh` is the project's one exception to "no npm". It
installs Pi with `--ignore-scripts` from its published shrinkwrap, checks the
tarball integrity against `pins.json`, and audits the whole dependency tree
against OSV before it links `~/.local/bin/pi`.

After an upgrade of this repository, run `node bin/underpass.ts update`.

## Use

Run `pi` as usual inside any git project. The KMP and MADE tools show up
alongside Pi's own. Two Pi commands are added:

- `/underpass-status` shows the project, the servers that are running, and each tool catalog's version, size and fingerprint.
- `/underpass-phase interactive|design|run` switches which Underpass tools are active
  (`run` adds starting a published MADE ceremony and driving it to its end).

### Tool argument diagnostics

Before Pi validates a KMP or MADE tool call against the tool's input schema, the
extension checks the arguments itself. When they do not match, the model gets one
focused error instead of TypeBox's cascade over every `oneOf` branch: each line is a
path and what is wrong there, only for the branch the call was aiming at (a stage
with `group` is the group branch; a `kind` or `strategy` constant picks its branch),
with the schema's description or expected shape. For example:

```text
made_design_ceremony: the arguments do not match its input schema. Fix these and call it again:
  - stages[0].group.repeat: unknown fields "step", "output_field", "equals"; allowed: max_iterations, until; missing required field "until" — Optional bounded repeat-until policy for the whole group state. — expected {max_iterations, until: {equals, output_field, step}}
```

Arguments that match go through untouched and Pi still validates them. The
diagnostic is only raised when Pi's own validator rejects the arguments too, so it
never refuses a call Pi would accept.

### Tool learning

The host learns which KMP and MADE tools are worth exposing in each phase of
each project, from the project's own event log. It starts in `shadow`: every
request records the selection it would have made and the model keeps the whole
set of the phase. `node bin/underpass.ts learning report [--context <phase>]`
shows what it learnt and how often the selection would have missed a tool the
model used. `learning mode active [--k N]` applies it: `kmp_wake`, `kmp_ask`
and MADE's status tools stay on, plus the `k` best candidates (12 by default,
4 to 64); one decision in ten keeps the whole set as a control group, and
`doctor` warns if that group does better. `learning mode shadow` or
`learning mode off` turns it back.

The project in each learning context is the same HMAC id as the OTLP export,
so the host makes sure the per-install `telemetry.key` exists on every start,
even without OTLP.

**Upgrading to tool learning is one-way.** The first decision writes new fact
types (`tools.selected`, `learning.mode_changed`) that older versions cannot
read: once a project's log has them, do not go back to a version without tool
learning. After `underpass update`, restart Pi (and with it the host) before
running `learning mode`, so that no older host is still writing that log.

### MADE authorization

`made-mcp` runs embedded with a single principal, the trusted host, which owns the
authorization policy. When MADE denies a call, the host reads the decision (the
exact action and scope) and acts on its class:

- **Reads and drafts** (`design_ceremony`, `validate_ceremony_draft`,
  `explain_ceremony_draft`, `diff_ceremony_definitions`, `list_contracts`…) are
  granted on their own, for that exact action and scope, until the session closes
  (12 h at most), and the call is retried once.
- **Writes** (`publish_ceremony_definition`, starting or advancing ceremonies…)
  ask for confirmation in Pi's TUI; if you accept, the host grants that one action
  for five minutes, runs the confirmed call and revokes the grant as soon as the call
  returns, so it covers that call only. Without a UI (`pi -p`) they are refused.
- **Authorization admin** tools are never granted to the model: they are left out of
  the MADE tools Pi sees, and the host refuses them without reaching MADE. Nothing is
  granted for a tool the current phase does not expose, and only `design_ceremony`,
  `list_contracts` and `diff_ceremony_definitions` are ever granted a global scope.

In the `run` phase, starting a published ceremony
(`made_start_published_ceremony`, with a `ceremony_id`) is the one call you confirm.
Once it starts, the host records that this session started that instance, and
claiming, completing and applying transitions on *that* instance are granted on
their own, scoped to the instance, until it reaches a terminal state (then they
are revoked) or the session closes. On any other instance they still ask. Outside
`run` the host does not even pass them to MADE. `/underpass-status` and
`node bin/underpass.ts made ceremonies` list the instances a session started and
their grants.

Grants are revoked when the session closes; a host that starts revokes those a
previous one left behind. `node bin/underpass.ts made grants` lists them and
`made revoke-orphans` cleans up by hand. `doctor` checks it under `[made-auth]` and
`/underpass-status` shows `made: <n> active grants · <m> confirmations`. Every grant,
revocation and confirmation is a fact in the project's event log.

Like tool learning, this adds fact types (`made.grant_issued`, `made.grant_revoked`,
`made.confirmation`, and with the `run` phase `made.ceremony_started` and
`made.ceremony_ended`) that versions before it cannot read. From this version on,
the log readers keep fact types they do not know as opaque records, so later
versions can add types without breaking this one.

### OTLP export (optional)

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (`https://`, or plain `http://` only for
`localhost`, `127.0.0.1` or `[::1]`) before starting `pi`, and the host sends
traces and metrics as OTLP/HTTP JSON. `OTEL_EXPORTER_OTLP_HEADERS`,
`OTEL_EXPORTER_OTLP_TIMEOUT` and `OTEL_RESOURCE_ATTRIBUTES` are honoured.
Two things to know before you turn it on:

- **It backfills the whole history.** Traces come from the project's event
  log, so the first export sends every session already recorded. Some
  backends drop spans older than their ingestion window; those are lost there,
  not locally.
- **Delivery is at least once.** A pass with more than 512 spans goes out as
  several POSTs; if a later one fails, the retry resends the chunks already
  accepted, with identical trace and span ids.

The project is identified by `service.instance.id` = `pi_runtime.project` =
HMAC-SHA256 of the project id under a per-install secret, never by its path.

## Where things live

| Path | Contents |
|---|---|
| `${XDG_STATE_HOME:-~/.local/state}/pi-runtime/projects/<id>/` | Per-project host socket, lock and `host.log` |
| `${XDG_STATE_HOME:-~/.local/state}/pi-runtime/fingerprints.json` | Recorded tool-catalog fingerprints |
| `${XDG_STATE_HOME:-~/.local/state}/pi-runtime/telemetry.key` | Per-install telemetry secret (`0600`, created on the first host start, never rotated or printed) |
| `${XDG_DATA_HOME:-~/.local/share}/pi-runtime/bin/` | Pinned `kmp-mcp` and `made-mcp` binaries |
| `${XDG_DATA_HOME:-~/.local/share}/pi-runtime/pi-<version>/` | Pi install (override with `PI_RUNTIME_PREFIX`) |
| `${XDG_STATE_HOME:-~/.local/state}/underpass-made/ceremonies.sqlite3` | MADE store (override with `MADE_MCP_STORE_PATH`) |
| `${XDG_CONFIG_HOME:-~/.config}/underpass-made/embedded/` | MADE private config, in the same format the MADE plugin uses. It is never rotated, and its key never appears in arguments or output. |

## Development

```bash
npm test    # unit + architecture tests, coverage gate ≥ 80 % lines/branches/functions
```

- Plain TypeScript run by Node's native type stripping. Zero npm dependencies: never run `npm install`.
- Hexagonal architecture with DDD: `domain` (value objects, no I/O) ← `application` (ports, DTOs, mappers, use cases) ← `adapters` (inbound: Pi, CLI, IPC; outbound: MCP stdio, GitHub, OSV, fs, processes) ← `composition`.
- One class, interface or type alias per file, and no primitive crosses a domain boundary. Architecture tests enforce the layer dependencies and the one-per-file rule.

## Documents

- Design spec: [`docs/specs/2026-09-28-pi-runtime-design.md`](docs/specs/2026-09-28-pi-runtime-design.md)
- S1 + P0 implementation plan: [`docs/plans/2026-09-28-s1-distribucion-p0-contratos.md`](docs/plans/2026-09-28-s1-distribucion-p0-contratos.md)
- P0 contract findings: [`docs/contracts/p0-findings.md`](docs/contracts/p0-findings.md)
- S1 acceptance on a real installation: [`docs/acceptance/s1.md`](docs/acceptance/s1.md)
- F1 (tool argument diagnostics) acceptance on a real installation: [`docs/acceptance/f1.md`](docs/acceptance/f1.md)
- S3a (host-managed MADE authorization): [spec](docs/specs/2026-09-30-s3a-made-authorization-design.md), [plan](docs/plans/2026-09-30-s3a-made-authorization.md), [MADE issues](docs/upstream/2026-09-30-made-s3a-issues.md)
- F3 (run phase: start a published ceremony and drive it to its end): [spec](docs/specs/2026-09-30-f3-made-run-phase-design.md), [plan](docs/plans/2026-09-30-f3-made-run-phase.md), [acceptance](docs/acceptance/f3.md)

The design documents are in Spanish.
