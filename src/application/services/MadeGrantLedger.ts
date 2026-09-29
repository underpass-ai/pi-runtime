import type { EventRecord } from "../../domain/events/EventRecord.ts";
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import { CeremonyEndReason } from "../../domain/made/CeremonyEndReason.ts";
import type { CeremonyId } from "../../domain/made/CeremonyId.ts";
import { GrantSequence } from "../../domain/made/GrantSequence.ts";
import type { MadeAction } from "../../domain/made/MadeAction.ts";
import { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeScope } from "../../domain/made/MadeScope.ts";
import { RevocationReason } from "../../domain/made/RevocationReason.ts";
import { StartedCeremony } from "../../domain/made/StartedCeremony.ts";
import type { EventStore } from "../ports/EventStore.ts";

// Como en O1 y L1: una sesión sin hechos durante 24 h está abandonada.
const ABANDONED_AFTER_MS = 24 * 3_600_000;
const PAGE = 1_000;

type SessionMark = { closed: boolean; lastMs: number };
type GrantState = "active" | "expired" | "revoked";

// Los grants que el host registró en el log (S3a §4), reconstruidos de sus hechos: emitidos
// (sesión), revocados (host), y el cierre y la última actividad de Pi de sus sesiones. Un payload
// inesperado se ignora: el log nunca rompe la lectura.
export class MadeGrantLedger {
  readonly #grants = new Map<string, MadeGrant>(); readonly #revoked = new Map<string, string>();
  readonly #sessions = new Map<string, SessionMark>(); readonly #confirmations = new Map<string, number>();
  // Grants emitidos antes de un session.closed de su sesión: huérfanos aunque la sesión se reabra.
  readonly #closedOver = new Set<string>();
  // F3: las instancias que arrancó cada sesión (por sesión, por id de instancia).
  readonly #ceremonies = new Map<string, Map<string, StartedCeremony>>();
  private constructor() {}

  static of(records: Iterable<EventRecord>): MadeGrantLedger {
    const ledger = new MadeGrantLedger();
    for (const r of records) ledger.#visit(r);
    return ledger;
  }

  // Todo el log, por páginas.
  static read(events: EventStore): MadeGrantLedger {
    const ledger = new MadeGrantLedger();
    let after = GlobalPosition.START;
    for (;;) {
      const page = events.readAll(after, PAGE);
      if (page.length === 0) return ledger;
      for (const e of page) ledger.#visit(e.record);
      after = page.at(-1)!.position;
    }
  }

  // Sólo lo que hace falta para una sesión: su stream y las revocaciones del host.
  static forSession(events: EventStore, session: SessionId): MadeGrantLedger {
    return MadeGrantLedger.of([...events.readStream(StreamId.session(session)), ...events.readStream(StreamId.HOST)]);
  }

  #visit(r: EventRecord): void {
    const p = r.payload.toValue() as Record<string, unknown> | null;
    if (r.stream.isSession()) {
      const sid = r.stream.sessionId().value;
      const mark = this.#sessions.get(sid) ?? { closed: false, lastMs: 0 };
      // La actividad es de Pi: la auditoría de MADE y los tipos opacos no alargan la vida de la sesión.
      if (r.type.known() && !r.type.madeAudit()) mark.lastMs = Math.max(mark.lastMs, r.recordedAt.epochMs());
      if (r.type.value === "session.opened") mark.closed = false;
      if (r.type.value === "session.closed") {
        mark.closed = true;
        for (const g of this.#grants.values()) if (g.session.value === sid) this.#closedOver.add(g.id.value);
      }
      this.#sessions.set(sid, mark);
      if (r.type.value === "made.grant_issued") {
        try { const g = MadeGrant.fromFact(r.stream.sessionId(), p, r.occurredAt); this.#grants.set(g.id.value, g); } catch { /* payload inesperado */ }
      }
      if (r.type.value === "made.ceremony_started") this.#started(r.stream.sessionId(), p, r);
      if (r.type.value === "made.ceremony_ended") this.#ended(sid, p);
      if (r.type.value === "made.confirmation") this.#confirmations.set(sid, (this.#confirmations.get(sid) ?? 0) + 1);
      return;
    }
    if (r.type.value === "made.grant_revoked" && typeof p?.grantId === "string" && !this.#revoked.has(p.grantId)) this.#revoked.set(p.grantId, typeof p.reason === "string" ? p.reason : "unknown");
  }

  #started(session: SessionId, p: unknown, r: EventRecord): void {
    let started: StartedCeremony;
    try { started = StartedCeremony.fromFact(session, p, r.occurredAt); } catch { return; /* payload inesperado */ }
    const mine = this.#ceremonies.get(session.value) ?? new Map<string, StartedCeremony>();
    if (!mine.has(started.ceremony.value)) mine.set(started.ceremony.value, started);
    this.#ceremonies.set(session.value, mine);
  }

  #ended(sid: string, p: Record<string, unknown> | null): void {
    const started = typeof p?.ceremonyId === "string" ? this.#ceremonies.get(sid)?.get(p.ceremonyId) : undefined;
    if (started !== undefined && started.running()) this.#ceremonies.get(sid)!.set(started.ceremony.value, started.ended(CeremonyEndReason.of(p!.endReason)));
  }

  state(grant: MadeGrant, now: Timestamp): GrantState {
    if (this.#revoked.has(grant.id.value)) return "revoked";
    return grant.expired(now) ? "expired" : "active";
  }

  // Por qué se revocó (session_closed, expired_cleanup, consumed), o null si no se revocó.
  revocation(grant: MadeGrant): string | null { return this.#revoked.get(grant.id.value) ?? null; }

  // Todos los grants del host, por instante de emisión.
  grants(): MadeGrant[] { return [...this.#grants.values()].sort((a, b) => a.validFrom.epochMs() - b.validFrom.epochMs() || a.id.value.localeCompare(b.id.value)); }

  // Los vigentes de la sesión actual: sin los emitidos antes de un cierre suyo (huérfanos aunque la
  // sesión se reabriera), que el barrido revoca y el estado de la sesión no cuenta.
  live(session: SessionId, now: Timestamp): MadeGrant[] {
    return this.grants().filter((g) => g.session.equals(session) && !this.#closedOver.has(g.id.value) && this.state(g, now) === "active");
  }

  // Sin revocar y con la sesión cerrada o emitidos antes de un cierre suyo, aunque luego se reabriera
  // (session_closed), o con la sesión abandonada o el grant caducado (expired_cleanup).
  orphans(now: Timestamp): { grant: MadeGrant; reason: RevocationReason }[] {
    const out: { grant: MadeGrant; reason: RevocationReason }[] = [];
    for (const g of this.grants()) {
      if (this.#revoked.has(g.id.value)) continue;
      const mark = this.#sessions.get(g.session.value);
      if (mark?.closed || this.#closedOver.has(g.id.value)) out.push({ grant: g, reason: RevocationReason.SESSION_CLOSED });
      else if (mark === undefined || now.epochMs() >= mark.lastMs + ABANDONED_AFTER_MS || g.expired(now)) out.push({ grant: g, reason: RevocationReason.EXPIRED_CLEANUP });
    }
    return out;
  }

  // F3: las instancias que arrancó la sesión, por instante de arranque.
  ceremonies(session: SessionId): StartedCeremony[] {
    return [...(this.#ceremonies.get(session.value)?.values() ?? [])].sort((a, b) => a.startedAt.epochMs() - b.startedAt.epochMs() || a.ceremony.value.localeCompare(b.ceremony.value));
  }

  // La instancia si la arrancó esta sesión y aún no llegó a un terminal; null si no.
  running(session: SessionId, ceremony: CeremonyId): StartedCeremony | null {
    const found = this.#ceremonies.get(session.value)?.get(ceremony.value);
    return found !== undefined && found.running() ? found : null;
  }

  // Los grants vigentes de la sesión con exactamente este alcance (los de una instancia).
  liveOn(session: SessionId, scope: MadeScope, now: Timestamp): MadeGrant[] { return this.live(session, now).filter((g) => g.scope.equals(scope)); }

  // Todas las sesiones con alguna instancia arrancada (para `underpass made ceremonies`).
  sessionsWithCeremonies(): SessionId[] { return [...this.#ceremonies.keys()].sort().map((s) => SessionId.of(s)); }

  // Cuántos grants con esta sesión, acción y alcance registró ya el host: la secuencia del siguiente.
  sequence(session: SessionId, action: MadeAction, scope: MadeScope): GrantSequence {
    return GrantSequence.of(this.grants().filter((g) => g.session.equals(session) && g.action.equals(action) && g.scope.equals(scope)).length);
  }

  confirmations(session: SessionId): number { return this.#confirmations.get(session.value) ?? 0; }
}
