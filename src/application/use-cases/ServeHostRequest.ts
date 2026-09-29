import { SessionId } from "../../domain/events/SessionId.ts";
import { Timestamp } from "../../domain/events/Timestamp.ts";
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
import { CallServerTool } from "./CallServerTool.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";
import type { ReadSessionStatus } from "./ReadSessionStatus.ts";
import type { RecordFact } from "./RecordFact.ts";
import type { SelectTools } from "./SelectTools.ts";

export class ServeHostRequest {
  readonly #project: Project; readonly #pool: ServerPool; readonly #responses = new HostResponseMapper();
  readonly #record: RecordFact | null; readonly #summaries: ReadSessionStatus | null; readonly #select: SelectTools | null; readonly #catalogs: KnownCatalogs | null;
  // catalogs recuerda cada catálogo servido: SelectTools filtra con ellos las candidatas de L1.
  constructor(project: Project, pool: ServerPool, record: RecordFact | null = null, summaries: ReadSessionStatus | null = null,
    select: SelectTools | null = null, catalogs: KnownCatalogs | null = null) {
    this.#project = project; this.#pool = pool; this.#record = record; this.#summaries = summaries; this.#select = select; this.#catalogs = catalogs;
  }

  async execute(req: HostRequestDto): Promise<HostResponseDto> {
    if (req.method === "record") {
      const record = this.#record;
      if (record === null) return this.#responses.invalid(req.id, "event log not available");
      return this.#guarded(req.id, () => {
        const r = record.execute(new FactMapper().toDomain(req.fact));
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
      return this.#guarded(req.id, () => select.execute(SessionId.of(req.sessionId), Phase.of(req.phase), req.deadlineMs === undefined ? null : Timestamp.fromEpochMs(req.deadlineMs)));
    }
    if (req.method === "health") return this.#responses.success(req.id, { project: this.#project.root.value, started: this.#pool.started().map(String) });
    let server: ServerName; let tool: ToolName | null = null;
    try {
      server = ServerName.of(req.server);
      if (req.method === "call") tool = ToolName.of(req.tool);
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
      const outcome = await new CallServerTool(this.#pool).execute(server, tool!, (req as { args: Record<string, unknown> }).args ?? {});
      if (outcome instanceof ToolRefusal) return this.#responses.refusal(req.id, outcome);
      return this.#responses.success(req.id, new ToolOutcomeMapper().toDto(outcome));
    } catch (e) {
      return this.#responses.failure(req.id, e);
    }
  }

  // Una DomainError es culpa de la petición (invalid); cualquier otra cosa, del host.
  #guarded(id: number, fn: () => unknown): HostResponseDto {
    try { return this.#responses.success(id, fn()); }
    catch (e) { return e instanceof DomainError ? this.#responses.invalid(id, e.message) : this.#responses.failure(id, e); }
  }
}
