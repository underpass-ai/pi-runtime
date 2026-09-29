import { SessionId } from "../../domain/events/SessionId.ts";
import { Timestamp } from "../../domain/events/Timestamp.ts";
import { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import { ConfirmationToken } from "../../domain/made/ConfirmationToken.ts";
import { MadeCallContext } from "../../domain/made/MadeCallContext.ts";
import { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Project } from "../../domain/project/Project.ts";
import { Phase } from "../../domain/session/Phase.ts";
import { DomainError } from "../../domain/shared/DomainError.ts";
import type { HostRequestDto } from "../dto/HostRequestDto.ts";
import type { HostResponseDto } from "../dto/HostResponseDto.ts";
import { CatalogMapper } from "../mappers/CatalogMapper.ts";
import { FactMapper } from "../mappers/FactMapper.ts";
import { HostResponseMapper } from "../mappers/HostResponseMapper.ts";
import { ToolOutcomeMapper } from "../mappers/ToolOutcomeMapper.ts";
import type { KnownCatalogs } from "../services/KnownCatalogs.ts";
import type { ServerPool } from "../services/ServerPool.ts";
import type { CallMadeTool } from "./CallMadeTool.ts";
import { CallServerTool } from "./CallServerTool.ts";
import type { DeclineMadeConfirmation } from "./DeclineMadeConfirmation.ts";
import type { RevokeMadeGrants } from "./RevokeMadeGrants.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";
import type { ReadSessionStatus } from "./ReadSessionStatus.ts";
import type { RecordFact } from "./RecordFact.ts";
import type { SelectTools } from "./SelectTools.ts";

// S3a: la autorización de MADE gestionada por el host.
// revoke: al registrarse un session.closed, los grants de esa sesión se revocan en segundo plano.
type MadeRequests = { call: CallMadeTool; decline: DeclineMadeConfirmation; revoke?: RevokeMadeGrants };

export class ServeHostRequest {
  readonly #project: Project; readonly #pool: ServerPool; readonly #responses = new HostResponseMapper();
  readonly #record: RecordFact | null; readonly #summaries: ReadSessionStatus | null; readonly #select: SelectTools | null; readonly #catalogs: KnownCatalogs | null;
  readonly #made: MadeRequests | null;
  // catalogs recuerda cada catálogo servido: SelectTools filtra con ellos las candidatas de L1.
  constructor(project: Project, pool: ServerPool, record: RecordFact | null = null, summaries: ReadSessionStatus | null = null,
    select: SelectTools | null = null, catalogs: KnownCatalogs | null = null, made: MadeRequests | null = null) {
    this.#project = project; this.#pool = pool; this.#record = record; this.#summaries = summaries; this.#select = select; this.#catalogs = catalogs; this.#made = made;
  }

  async execute(req: HostRequestDto): Promise<HostResponseDto> {
    if (req.method === "record") {
      const record = this.#record;
      if (record === null) return this.#responses.invalid(req.id, "event log not available");
      return this.#guarded(req.id, () => {
        const fact = new FactMapper().toDomain(req.fact);
        const r = record.execute(fact);
        // La respuesta a Pi no espera: RevokeMadeGrants nunca lanza y el apagado la espera con tope.
        if (fact.type.value === "session.closed" && fact.stream.isSession()) void this.#made?.revoke?.execute(fact.stream.sessionId());
        return { recorded: r.records.length, idempotent: r.idempotent };
      });
    }
    if (req.method === "summary") {
      const summaries = this.#summaries;
      if (summaries === null) return this.#responses.invalid(req.id, "event log not available");
      return this.#guarded(req.id, () => summaries.execute(SessionId.of(req.sessionId)));
    }
    if (req.method === "select") {
      const select = this.#select;
      if (select === null) return this.#responses.invalid(req.id, "learning not available");
      return this.#guarded(req.id, () => select.execute(SessionId.of(req.sessionId), Phase.of(req.phase), req.deadlineMs === undefined ? null : Timestamp.fromEpochMs(req.deadlineMs),
        ServeHostRequest.#registered(req.registered)));
    }
    if (req.method === "confirmation") {
      const made = this.#made;
      if (made === null) return this.#responses.invalid(req.id, "made authorization not available");
      return this.#guarded(req.id, () => made.decline.execute(SessionId.of(req.sessionId), ConfirmationToken.of(req.token), ConfirmationOutcome.refusal(req.outcome)));
    }
    if (req.method === "health") return this.#responses.success(req.id, { project: this.#project.root.value, started: this.#pool.started().map(String) });
    let server: ServerName; let tool: ToolName | null = null; let context: MadeCallContext | null = null;
    try {
      server = ServerName.of(req.server);
      // El contexto sólo lo consume la autorización de MADE: una llamada a otro servidor no lo valida.
      if (req.method === "call") { tool = ToolName.of(req.tool); if (this.#authorizes(server)) context = ServeHostRequest.#context(req); }
    } catch (e) {
      return this.#responses.invalid(req.id, (e as Error).message);
    }
    try {
      if (req.method === "catalog") {
        let catalog: ToolCatalog;
        try { catalog = await new ReadServerCatalog(this.#pool).execute(server); }
        catch (e) { this.#catalogs?.unavailable(server); throw e; }
        this.#catalogs?.remember(catalog);
        return this.#responses.success(req.id, new CatalogMapper().toDto(catalog));
      }
      const args = (req as { args: Record<string, unknown> }).args ?? {};
      const outcome = this.#authorizes(server)
        ? await this.#made!.call.execute(tool!, args, context)
        : await new CallServerTool(this.#pool).execute(server, tool!, args);
      if (outcome instanceof PendingConfirmation) return this.#responses.needsConfirmation(req.id, outcome);
      if (outcome instanceof ToolRefusal) return this.#responses.refusal(req.id, outcome);
      return this.#responses.success(req.id, new ToolOutcomeMapper().toDto(outcome));
    } catch (e) {
      return this.#responses.failure(req.id, e);
    }
  }

  // La llamada pasa por la autorización de MADE del host (S3a).
  #authorizes(server: ServerName): boolean { return server.equals(ServerName.MADE) && this.#made !== null; }

  // Sesión, fase y token de la llamada (S3a); sin sesión (extensión anterior), null: el host no autoriza nada.
  static #context(req: { sessionId?: string; phase?: string | null; confirmation?: string }): MadeCallContext | null {
    if (req.sessionId === undefined) return null;
    return MadeCallContext.of(SessionId.of(req.sessionId), req.phase === undefined || req.phase === null ? null : Phase.of(req.phase),
      req.confirmation === undefined ? null : ConfirmationToken.of(req.confirmation));
  }

  // Nombres de nuestras tools registradas en Pi (ruling R7); ausente, null (extensión anterior).
  static #registered(raw: unknown): ToolName[] | null {
    if (raw === undefined) return null;
    if (!Array.isArray(raw)) throw DomainError.because("registered must be a list of tool names");
    return raw.map((n) => ToolName.of(n as string));
  }

  // Una DomainError es culpa de la petición (invalid); cualquier otra cosa, del host.
  #guarded(id: number, fn: () => unknown): HostResponseDto {
    try { return this.#responses.success(id, fn()); }
    catch (e) { return e instanceof DomainError ? this.#responses.invalid(id, e.message) : this.#responses.failure(id, e); }
  }
}
