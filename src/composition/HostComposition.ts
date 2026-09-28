import { join } from "node:path";
import { FsOwnerLock } from "../adapters/outbound/fs/FsOwnerLock.ts";
import { FsMadeConfigurationRepository } from "../adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { GitProjectLocator } from "../adapters/outbound/git/GitProjectLocator.ts";
import { JsonPinSetSource } from "../adapters/outbound/fs/JsonPinSetSource.ts";
import { UnixSocketHostServer } from "../adapters/inbound/ipc/UnixSocketHostServer.ts";
import { StdioMcpConnector } from "../adapters/outbound/mcp/StdioMcpConnector.ts";
import { KmpServerCommandFactory } from "../adapters/outbound/process/KmpServerCommandFactory.ts";
import { MadeServerCommandFactory } from "../adapters/outbound/process/MadeServerCommandFactory.ts";
import type { ServerCommandFactory } from "../application/ports/ServerCommandFactory.ts";
import { ServerPool } from "../application/services/ServerPool.ts";
import { ServeHostRequest } from "../application/use-cases/ServeHostRequest.ts";
import { BinaryName } from "../domain/distribution/BinaryName.ts";
import { StorePath } from "../domain/made/StorePath.ts";
import { StatePaths } from "./StatePaths.ts";

export class HostComposition {
  static async run(projectCwd: string, env: Record<string, string | undefined>, commands?: Map<string, ServerCommandFactory>): Promise<void> {
    const project = new GitProjectLocator().locate(projectCwd);
    const paths = new StatePaths(env);
    const lock = new FsOwnerLock(paths.projectDir(project)).acquire();
    if (!lock.owned) return;

    const pool = new ServerPool(project, new StdioMcpConnector(60_000), commands ?? HostComposition.#commands(env, paths));
    const serve = new ServeHostRequest(project, pool);
    const server = await UnixSocketHostServer.start(paths.socketOf(project), (req) => serve.execute(req));

    const idleMs = Number(env.UNDERPASS_HOST_IDLE_MS ?? 60_000);
    let idleSince = Date.now();
    const shutdown = async () => { clearInterval(timer); await server.close(); await pool.close(); lock.release(); };
    const finish = () => void shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
    const timer = setInterval(() => {
      if (server.clients() > 0) idleSince = Date.now();
      else if (Date.now() - idleSince >= idleMs) finish();
    }, Math.max(100, Math.min(1000, idleMs / 2)));
    process.once("SIGTERM", finish);
  }

  static #commands(env: Record<string, string | undefined>, paths: StatePaths): Map<string, ServerCommandFactory> {
    const pins = new JsonPinSetSource(new URL("../../pins.json", import.meta.url).pathname).load();
    const bin = (n: BinaryName) => join(paths.binDir(), pins.pinFor(n).installedFileName());
    const store = StorePath.of(env.MADE_MCP_STORE_PATH ?? join(env.XDG_STATE_HOME ?? join(env.HOME ?? "", ".local/state"), "underpass-made", "ceremonies.sqlite3"));
    const lazyMade: ServerCommandFactory = {
      commandFor: (p) => {
        const config = new FsMadeConfigurationRepository(env).load(store);
        if (!config) throw new Error("MADE private configuration missing; run `underpass setup`");
        return new MadeServerCommandFactory(bin(BinaryName.MADE), store, config, env).commandFor(p);
      },
    };
    return new Map([["kmp", new KmpServerCommandFactory(bin(BinaryName.KMP), env)], ["made", lazyMade]]);
  }
}
