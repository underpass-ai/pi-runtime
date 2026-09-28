import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
const tmpProject = () => Project.of(ProjectRoot.of(realpathSync(mkdtempSync(join(tmpdir(), "proj-")))));

export async function openKmp() {
  const env = { ...process.env, KMP_MCP_DATA_DIR: mkdtempSync(join(tmpdir(), "kmp-store-")) };
  return new StdioMcpConnector(60_000).open(ServerName.KMP, new KmpServerCommandFactory(KMP_BIN!, env).commandFor(tmpProject()));
}

export async function openMade() {
  const home = mkdtempSync(join(tmpdir(), "made-home-"));
  const env = { ...process.env, HOME: home };
  const store = StorePath.of(join(home, ".local/state/underpass-made/ceremonies.sqlite3"));
  mkdirSync(dirname(store.value), { recursive: true });
  const { configuration } = new EnsureMadeConfiguration(new FsMadeConfigurationRepository(env), new NodeEntropySource()).execute(store);
  execFileSync(MADE_BIN!, ["bootstrap-authorization", store.value, "--policy-id", configuration.policy.value, "--trusted-host-id", configuration.trustedHost.value]);
  return new StdioMcpConnector(60_000).open(ServerName.MADE, new MadeServerCommandFactory(MADE_BIN!, store, configuration, env).commandFor(tmpProject()));
}
