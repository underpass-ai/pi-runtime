import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectToProjectHost } from "../../../src/application/use-cases/ConnectToProjectHost.ts";
import { GitProjectLocator } from "../../../src/adapters/outbound/git/GitProjectLocator.ts";
import { UnixSocketHostGateway } from "../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { DetachedHostLauncher } from "../../../src/adapters/outbound/process/DetachedHostLauncher.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { ServerName } from "../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../src/domain/mcp/ToolName.ts";

const hostEntry = new URL("../../fixtures/test-host.ts", import.meta.url).pathname;
const fake = new URL("../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;

test("dos conexiones desde el mismo proyecto comparten un único host", async () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, "state"), UNDERPASS_HOST_IDLE_MS: "500", FAKE_SERVER_CMD: `${process.execPath} ${fake}` };
  const paths = new StatePaths(env);
  let launches = 0;
  const inner = new DetachedHostLauncher(hostEntry, env, (p) => paths.hostLogOf(p));
  const uc = new ConnectToProjectHost(new GitProjectLocator(), (s, r) => UnixSocketHostGateway.connect(s, r), (p) => paths.socketOf(p), { launch: (p) => { launches++; inner.launch(p); } });
  const a = await uc.execute(cwd);
  const b = await uc.execute(cwd);
  try {
    assert.equal(launches, 1);
    assert.deepEqual(await a.call(ServerName.KMP, ToolName.of("kmp_echo"), { x: 1 }), { structured: { x: 1 }, text: "{\"x\":1}" });
    assert.deepEqual(await b.health(), { project: cwd, started: ["kmp"] });
  } finally { a.close(); b.close(); }
});
