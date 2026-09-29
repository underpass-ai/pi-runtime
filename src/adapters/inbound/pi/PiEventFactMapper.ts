import { createHash } from "node:crypto";
import type { FactDto } from "../../../application/dto/FactDto.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const about = (raw: string) => raw.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 200);
// Sólo se interpreta el formato de error de nuestras tools (PiToolFactory):
// "<kmp_|made_tool> <kind> (<code>): …". El código se limita a un token corto
// para que nunca arrastre texto libre de la salida (rutas, secretos).
const ERROR = /^(?:kmp|made)_[A-Za-z0-9_]+ (refused|denied|rpc|transport|invalid) \(([A-Za-z0-9_.-]{1,64})\): /;

export class PiEventFactMapper {
  readonly #actorId: string; readonly #version: string;
  constructor(actorId: string, piRuntimeVersion: string) { this.#actorId = actorId; this.#version = piRuntimeVersion; }

  static serverOf(tool: string): "kmp" | "made" | "pi" { return tool.startsWith("kmp_") ? "kmp" : tool.startsWith("made_") ? "made" : "pi"; }

  static digest(value: unknown): { digest: string; bytes: number } {
    const text = JSON.stringify(value ?? null) ?? "null";
    return { digest: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text) };
  }

  // Con `tool`, las tools propias de Pi (bash, read…) nunca se interpretan:
  // su texto de error es salida arbitraria.
  static outcomeOf(isError: boolean, result: unknown, tool: string | null = null): { status: string; errorKind: string | null; errorCode: string | null } {
    if (!isError) return { status: "succeeded", errorKind: null, errorCode: null };
    if (tool !== null && PiEventFactMapper.serverOf(tool) === "pi") return { status: "failed", errorKind: "tool_error", errorCode: null };
    const content = obj(result).content;
    const text = Array.isArray(content) ? String(content.map(obj).find((c) => c.type === "text")?.text ?? "") : "";
    if (/aborted; outcome unknown/.test(text)) return { status: "aborted", errorKind: "aborted", errorCode: null };
    const m = ERROR.exec(text);
    if (m === null) return { status: "failed", errorKind: "tool_error", errorCode: null };
    return { status: m[1] === "refused" || m[1] === "denied" ? "refused" : "failed", errorKind: m[1], errorCode: m[2] === "-" ? null : m[2] };
  }

  sessionOpened(sid: string, reason: string, atMs: number): FactDto { return this.#fact(sid, "session.opened", `opened.${atMs}`, atMs, { reason, piRuntimeVersion: this.#version }); }
  sessionClosed(sid: string, reason: string, atMs: number): FactDto { return this.#fact(sid, "session.closed", `closed.${atMs}`, atMs, { reason }); }

  phaseChanged(sid: string, from: string | null, to: string, activeTools: string[], atMs: number): FactDto {
    return this.#fact(sid, "phase.changed", `phase.${atMs}`, atMs, { from, to, activeTools: activeTools.length, activeToolsDigest: PiEventFactMapper.digest([...activeTools].sort()).digest });
  }

  turnCompleted(sid: string, ev: unknown, startedAtMs: number | null, atMs: number): FactDto | null {
    const e = obj(ev); const msg = obj(e.message);
    if (msg.role !== "assistant") return null;
    const u = obj(msg.usage);
    return this.#fact(sid, "turn.completed", `turn.${str(e.messageEntryId) ?? atMs}`, atMs, {
      model: str(msg.model), provider: str(msg.provider), tokens: { input: num(u.input), output: num(u.output), cacheRead: num(u.cacheRead), cacheWrite: num(u.cacheWrite) },
      cost: num(obj(u.cost).total), durationMs: startedAtMs === null ? null : Math.max(0, atMs - startedAtMs), outcome: str(e.outcome), stopReason: str(msg.stopReason),
    });
  }

  toolStarted(sid: string, ev: unknown, atMs: number): FactDto {
    const e = obj(ev); const tool = String(e.toolName ?? "unknown"); const args = PiEventFactMapper.digest(e.args);
    return this.#fact(sid, "tool.started", `tool.${String(e.toolCallId)}.started`, atMs, { tool, server: PiEventFactMapper.serverOf(tool), callId: String(e.toolCallId), argsDigest: args.digest, argsBytes: args.bytes });
  }

  toolCompleted(sid: string, ev: unknown, startedAtMs: number | null, atMs: number): FactDto {
    const e = obj(ev); const tool = String(e.toolName ?? "unknown"); const out = PiEventFactMapper.digest(e.result);
    const o = PiEventFactMapper.outcomeOf(e.isError === true, e.result, tool);
    return this.#fact(sid, "tool.completed", `tool.${String(e.toolCallId)}.completed`, atMs, {
      tool, server: PiEventFactMapper.serverOf(tool), callId: String(e.toolCallId), durationMs: startedAtMs === null ? null : Math.max(0, atMs - startedAtMs),
      status: o.status, errorKind: o.errorKind, errorCode: o.errorCode, outputDigest: out.digest, outputBytes: out.bytes,
    });
  }

  modelSelected(sid: string, ev: unknown, atMs: number): FactDto | null {
    const e = obj(ev); const model = obj(e.model);
    if (str(model.id) === null) return null;
    return this.#fact(sid, "model.selected", `model.${atMs}`, atMs, { model: str(model.id), provider: str(model.provider), source: str(e.source) });
  }

  compacted(sid: string, ev: unknown, tokensAfter: number | null, atMs: number): FactDto | null {
    const e = obj(ev); const entry = obj(e.compactionEntry);
    if (Object.keys(entry).length === 0) return null;
    return this.#fact(sid, "context.compacted", `compact.${str(entry.id) ?? atMs}`, atMs, { tokensBefore: num(entry.tokensBefore), tokensAfter, reason: str(e.reason) });
  }

  #fact(sid: string, type: string, rawAbout: string, atMs: number, payload: Json): FactDto {
    return { stream: "session", sessionId: sid, type, typeVersion: 1, about: about(rawAbout), occurredAtMs: atMs, actor: { kind: "agent", id: this.#actorId }, payload };
  }
}
