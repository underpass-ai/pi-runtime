import { test } from "node:test";
import assert from "node:assert/strict";
import { HostFactFactory } from "../../../../src/application/services/HostFactFactory.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { FixedClock } from "../../../support/FixedClock.ts";

test("hechos del host con ids únicos y payloads de metadatos", () => {
  const f = new HostFactFactory(new FixedClock(1000), "42");
  const a = f.hostStarted("0.1.0", 42); const b = f.serverStarted(ServerName.KMP, ServerIdentity.of("underpass-kmp-mcp", SemVer.of("0.24.0")));
  const c = f.serverExited(ServerName.KMP); const d = f.hostStopped("idle");
  assert.deepEqual([a, b, c, d].map((x) => x.type.value), ["host.started", "server.started", "server.exited", "host.stopped"]);
  assert.equal(new Set([a, b, c, d].map((x) => x.id.value)).size, 4);
  assert.equal(a.id.value, "host:host.started:42.1000.0");
  assert.deepEqual(b.payload.toValue(), { server: "kmp", name: "underpass-kmp-mcp", version: "0.24.0" });
  assert.deepEqual(d.payload.toValue(), { reason: "idle" });
});

test("los hechos van al stream del host, con actor host y payloads completos", () => {
  const f = new HostFactFactory(new FixedClock(5000), "7");
  const a = f.hostStarted("0.1.0", 7);
  assert.ok(a.stream.equals(StreamId.HOST));
  assert.equal(a.actor.kind, "host"); assert.equal(a.actor.id, "host:7");
  assert.equal(a.occurredAt.epochMs(), 5000);
  assert.deepEqual(a.payload.toValue(), { version: "0.1.0", pid: 7 });
  assert.deepEqual(f.serverExited(ServerName.MADE).payload.toValue(), { server: "made" });
  assert.deepEqual(f.hostStopped("signal").payload.toValue(), { reason: "signal" });
});

test("un hostId que no sirve como about falla con DomainError", () => {
  assert.throws(() => new HostFactFactory(new FixedClock(), "a b").hostStarted("0.1.0", 1), DomainError);
});
