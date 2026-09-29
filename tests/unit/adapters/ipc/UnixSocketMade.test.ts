import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnixSocketHostServer } from "../../../../src/adapters/inbound/ipc/UnixSocketHostServer.ts";
import { UnixSocketHostGateway } from "../../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import type { HostRequestDto } from "../../../../src/application/dto/HostRequestDto.ts";
import { HostCallError } from "../../../../src/application/ports/HostCallError.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";

test("S3a por el socket: la llamada lleva sesión, fase y token; needs_confirmation trae la confirmación; confirmation está permitido", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "ipc-")), "host.sock");
  const seen: HostRequestDto[] = [];
  const confirmation = { token: "ab".repeat(16), action: "publish_ceremony_definition", scopeSummary: "definition d v1.0" };
  const server = await UnixSocketHostServer.start(path, async (req) => {
    seen.push(req);
    if (req.method === "confirmation") return { id: req.id, ok: true, result: { recorded: true } };
    if (req.method === "call" && req.server === "made" && req.confirmation === undefined) return { id: req.id, ok: false, error: { kind: "refused", code: "needs_confirmation", message: "m", confirmation } };
    return { id: req.id, ok: true, result: { structured: null, text: "published" } };
  });
  try {
    const gw = await UnixSocketHostGateway.connect(path);
    const publish = ToolName.of("made_publish_ceremony_definition");
    await assert.rejects(gw.call(ServerName.MADE, publish, { y: 1 }, { sessionId: "s1", phase: "design" }),
      (e) => HostCallError.is(e) && e.code === "needs_confirmation" && JSON.stringify(e.confirmation) === JSON.stringify(confirmation));
    assert.deepEqual(await gw.call(ServerName.MADE, publish, { y: 1 }, { sessionId: "s1", phase: "design", confirmation: confirmation.token }), { structured: null, text: "published" });
    assert.deepEqual(await gw.confirmation(SessionId.of("s1"), confirmation.token, "declined"), { recorded: true });
    assert.deepEqual(await gw.call(ServerName.KMP, ToolName.of("kmp_ask"), {}), { structured: null, text: "published" });
    assert.deepEqual(seen.map((r) => r.method === "call" ? [r.sessionId ?? null, r.phase ?? null, r.confirmation ?? null] : [r.method]),
      [["s1", "design", null], ["s1", "design", confirmation.token], ["confirmation"], [null, null, null]]);
    gw.close();
  } finally { await server.close(); }
});
