import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLineLogger } from "../../../../../src/adapters/outbound/log/JsonLineLogger.ts";
import { ManualClock } from "../../../../support/ManualClock.ts";

test("una línea JSON por entrada: ts, level, msg, trace_id y span_id en la raíz y los campos", () => {
  const path = join(mkdtempSync(join(tmpdir(), "hostlog-")), "host.log");
  const log = new JsonLineLogger(path, new ManualClock(1000));
  log.info("host started", { version: "0.1.0" });
  log.warn("otlp export failing", { trace_id: "a".repeat(32), span_id: "b".repeat(16), signal: "traces", n: 2, ok: false, gone: null });
  log.error("event log append failed", { error: "ENOENT: no such file or directory, open '/home/u/x/events.sqlite3'", msg: "ignored", trace_id: null });
  const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { ts: "1970-01-01T00:00:01.000Z", level: "info", msg: "host started", version: "0.1.0" },
    { ts: "1970-01-01T00:00:01.000Z", level: "warn", msg: "otlp export failing", trace_id: "a".repeat(32), span_id: "b".repeat(16), signal: "traces", n: 2, ok: false, gone: null },
    { ts: "1970-01-01T00:00:01.000Z", level: "error", msg: "event log append failed", error: "ENOENT: no such file or directory, open '<path>'" },
  ]);
  assert.deepEqual(Object.keys(lines[1]).slice(0, 5), ["ts", "level", "msg", "trace_id", "span_id"]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("scrub: rutas absolutas, ~, de Windows y URLs; el resto queda igual", () => {
  assert.equal(JsonLineLogger.scrub("open '/home/u/secret.txt' failed"), "open '<path>' failed");
  assert.equal(JsonLineLogger.scrub("at /tmp/x.sqlite3: locked"), "at <path> locked");
  assert.equal(JsonLineLogger.scrub("see ~/notes and C:\\Users\\t"), "see <path> and <path>");
  assert.equal(JsonLineLogger.scrub("POST http://collector.internal:4318/v1/traces"), "POST http:<path>");
  assert.equal(JsonLineLogger.scrub("3/5 calls, http 503"), "3/5 calls, http 503");
});

test("rota al llegar al tamaño máximo y conserva sólo host.log.1 a host.log.3", () => {
  const dir = mkdtempSync(join(tmpdir(), "hostlog-"));
  const path = join(dir, "host.log");
  const log = new JsonLineLogger(path, new ManualClock(0), 300);
  for (let i = 0; i < 40; i++) log.info(`line ${i}`, { pad: "x".repeat(40) });
  assert.deepEqual(readdirSync(dir).sort(), ["host.log", "host.log.1", "host.log.2", "host.log.3"]);
  for (const f of readdirSync(dir)) {
    assert.ok(statSync(join(dir, f)).size <= 300, f);
    for (const l of readFileSync(join(dir, f), "utf8").trim().split("\n")) JSON.parse(l);
  }
  assert.match(readFileSync(path, "utf8"), /line 39/);
});

test("nunca lanza aunque no pueda escribir", () => {
  const log = new JsonLineLogger(join(tmpdir(), "no-such-dir-o1", "nested", "host.log"), new ManualClock(0));
  assert.doesNotThrow(() => log.error("x"));
});
