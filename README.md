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
| Host | Bridging: one deterministic process per project that runs the MCP servers and hands their tools to Pi. It keeps no state machine, budget, authorization or validator of its own. |

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
- `/underpass-phase interactive|design` switches which Underpass tools are active.

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

The design documents are in Spanish.
