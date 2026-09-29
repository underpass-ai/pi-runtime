# Issues para `underpass-ai/made` que abre S3a

- **Fecha:** 2026-09-30
- **Contexto:** `docs/specs/2026-09-30-s3a-made-authorization-design.md` §0.4 y §6.
- **Estado:** borradores. Los abre Tirso; este documento no se usa para abrirlos.

Los textos van en inglés, como el resto del repositorio de MADE. Cada uno cita lo comprobado
con `made-mcp` 0.8.0 en modo embebido sobre un store temporal.

---

## 1. Narrower authorization scopes for `design_ceremony`, `list_contracts` and `diff_ceremony_definitions`

**Title:** `Embedded authorization: definition/contract scopes for design_ceremony, list_contracts and diff_ceremony_definitions`

**Body:**

> In embedded mode, `scope_for_tool` (`crates/made-mcp/src/embedded/embedded_tool_authorizer.rs`)
> falls back to `AuthorizationScope::Global` for every tool that names no resource field.
> Three read/draft tools end up there:
>
> - `made_design_ceremony` takes a `name` for the draft it designs, but is not in
>   `is_definition_action`, so its decision is `{"kind":"global"}`.
> - `made_list_contracts` takes no arguments and reads the contract registry.
> - `made_diff_ceremony_definitions` names two definitions (`before`/`after`, by
>   `ceremony` + `version` or by `definition_yaml`) and still resolves to `global`.
>
> A host that grants exact decisions (pi-runtime S3a) therefore has to issue a
> `global` grant, limited to that single action, to let a model design or compare a
> definition. We would like:
>
> 1. `design_ceremony` scoped as `definition { name, version: null }` from its `name`.
> 2. `diff_ceremony_definitions` scoped by the `after` definition (or both), like
>    `validate_ceremony_draft`.
> 3. A `contract` (or registry) scope for `list_contracts`, or a documented statement
>    that the registry is intentionally global.
>
> Verified with 0.8.0: `made_list_contracts {}` is denied with a decision whose scope is
> `{"kind":"global"}`; after a grant of `list_contracts` on `global`, it succeeds.

## 2. Document which tools bypass authorization (`made_get_help`)

**Title:** `Document that made_get_help (and discovery) are answered before the authorization gate`

**Body:**

> `made_get_help` has no `AuthorizationAction`: `server.rs` answers it before the
> backend, so it is never authorized. That is reasonable for help text, but it is not
> documented, and hosts cannot tell from the catalog which tools are gated. With 0.8.0
> embedded and an empty policy, `made_get_help {"audience":"agent"}` succeeds while
> `made_get_status` is denied.
>
> Please document (in the tool descriptions or in `made_discover_capabilities`) which
> tools are served without authorization, so a host can avoid asking for grants it
> does not need, and so the list is part of the contract.

## 3. A human principal distinct from the trusted host in embedded mode

**Title:** `Embedded mode: allow a second (human) principal so approvals can be used`

**Body:**

> In embedded mode every call runs as the single principal `MADE_AUTH_TRUSTED_HOST_ID`,
> which is also the policy owner. `made_approve_authorization_operation` therefore
> cannot be used: the separation rule requires the approver to differ from the
> executor, and there is only one identity. pi-runtime works around it by asking the
> person in its own TUI and then issuing a five-minute exact grant as the owner.
>
> Long term we would like the embedded host to be able to present a second, human
> principal (for example, configured next to the trusted host id and authenticated by
> the local host), so the native approval flow, with its decision and evidence, can
> record who approved a write. Out of scope for pi-runtime S3a; filed for later.
