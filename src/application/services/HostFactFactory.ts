import { Actor } from "../../domain/events/Actor.ts";
import { EventAbout } from "../../domain/events/EventAbout.ts";
import { EventId } from "../../domain/events/EventId.ts";
import { EventType } from "../../domain/events/EventType.ts";
import { Fact } from "../../domain/events/Fact.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { TypeVersion } from "../../domain/events/TypeVersion.ts";
import type { CatalogFingerprint } from "../../domain/mcp/CatalogFingerprint.ts";
import type { ServerIdentity } from "../../domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import type { Clock } from "../ports/Clock.ts";

// Hechos del ciclo de vida del host y de sus servidores MCP, sobre el stream
// del host. Sólo metadatos: versión, pid, huellas de catálogo (id y sha256),
// nombre, versión y código de salida del servidor.
export class HostFactFactory {
  readonly #clock: Clock; readonly #hostId: string; readonly #actor: Actor; #seq = 0;
  constructor(clock: Clock, hostId: string) { this.#clock = clock; this.#hostId = hostId; this.#actor = Actor.of("host", `host:${hostId}`); }

  hostStarted(version: string, pid: number, catalogs: Map<string, CatalogFingerprint>): Fact {
    return this.#fact("host.started", { version, pid, catalogs: Object.fromEntries([...catalogs].map(([k, v]) => [k, v.value])) });
  }
  hostStopped(reason: "idle" | "signal"): Fact { return this.#fact("host.stopped", { reason }); }
  serverStarted(server: ServerName, identity: ServerIdentity): Fact { return this.#fact("server.started", { server: server.value, name: identity.name, version: identity.version.value }); }
  serverExited(server: ServerName, code: number | null): Fact { return this.#fact("server.exited", { server: server.value, code }); }

  #fact(type: string, payload: Record<string, unknown>): Fact {
    const now = this.#clock.now(); const t = EventType.of(type);
    const about = EventAbout.of(`${this.#hostId}.${now.epochMs()}.${this.#seq++}`);
    return Fact.of({ id: EventId.derive(StreamId.HOST, t, about), stream: StreamId.HOST, type: t, typeVersion: TypeVersion.V1, occurredAt: now, actor: this.#actor, payload: CanonicalJson.of(payload) });
  }
}
