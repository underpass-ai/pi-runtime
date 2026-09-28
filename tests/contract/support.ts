import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { McpConnection } from "../../src/application/ports/McpConnection.ts";
import { StdioMcpConnector } from "../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { KmpServerCommandFactory } from "../../src/adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeServerCommandFactory } from "../../src/adapters/outbound/process/MadeServerCommandFactory.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { NodeEntropySource } from "../../src/adapters/outbound/crypto/NodeEntropySource.ts";
import { EnsureMadeConfiguration } from "../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { StorePath } from "../../src/domain/made/StorePath.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import { Project } from "../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../src/domain/project/ProjectRoot.ts";

export const KMP_BIN = process.env.UNDERPASS_KMP_MCP_BIN;
export const MADE_BIN = process.env.UNDERPASS_MADE_MCP_BIN;

const tmpProjectDir = () => realpathSync(mkdtempSync(join(tmpdir(), "proj-")));

// Delegates every McpConnection member to `conn` unchanged, except close(): that one also
// removes the mkdtemp directories this open() call created, so a contract test run doesn't
// leak a pair of temp dirs per connection under the OS tmpdir.
function withTempCleanup(conn: McpConnection, dirs: string[]): McpConnection {
  return {
    server: conn.server,
    identity: conn.identity,
    protocol: conn.protocol,
    catalog: () => conn.catalog(),
    call: (tool, args) => conn.call(tool, args),
    onExit: (listener) => conn.onExit(listener),
    close: async () => {
      try {
        await conn.close();
      } finally {
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export async function openKmp(): Promise<McpConnection> {
  const dataDir = mkdtempSync(join(tmpdir(), "kmp-store-"));
  const projectDir = tmpProjectDir();
  const env = { ...process.env, KMP_MCP_DATA_DIR: dataDir };
  const conn = await new StdioMcpConnector(60_000).open(ServerName.KMP, new KmpServerCommandFactory(KMP_BIN!, env).commandFor(Project.of(ProjectRoot.of(projectDir))));
  return withTempCleanup(conn, [dataDir, projectDir]);
}

export async function openMade(): Promise<McpConnection> {
  const home = mkdtempSync(join(tmpdir(), "made-home-"));
  const projectDir = tmpProjectDir();
  const env = { ...process.env, HOME: home };
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  mkdirSync(dirname(store.value), { recursive: true });
  const { configuration } = new EnsureMadeConfiguration(new FsMadeConfigurationRepository(join(home, ".config/underpass-made/embedded")), new NodeEntropySource()).execute(store);
  execFileSync(MADE_BIN!, ["bootstrap-authorization", store.value, "--policy-id", configuration.policy.value, "--trusted-host-id", configuration.trustedHost.value]);
  const conn = await new StdioMcpConnector(60_000).open(ServerName.MADE, new MadeServerCommandFactory(MADE_BIN!, store, configuration, env).commandFor(Project.of(ProjectRoot.of(projectDir))));
  return withTempCleanup(conn, [home, projectDir]);
}
