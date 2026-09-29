#!/usr/bin/env node
// Host real de pi-runtime (HostComposition) con el made-mcp de UNDERPASS_MADE_MCP_BIN sobre el
// store y la configuración que resuelva el entorno (XDG_STATE_HOME, XDG_CONFIG_HOME temporales)
// y el servidor MCP falso como KMP. Lo usa el contrato de S3a.
import { HostComposition } from "../../src/composition/HostComposition.ts";
import { StatePaths } from "../../src/composition/StatePaths.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { LazyMadeServerCommandFactory } from "../../src/adapters/outbound/process/LazyMadeServerCommandFactory.ts";
import type { ServerCommandFactory } from "../../src/application/ports/ServerCommandFactory.ts";

const bin = process.env.UNDERPASS_MADE_MCP_BIN;
if (!bin) throw new Error("UNDERPASS_MADE_MCP_BIN is required by made-host.ts");
const paths = new StatePaths(process.env);
const fake = new URL("./fake-mcp-server.ts", import.meta.url).pathname;
const commands = new Map<string, ServerCommandFactory>([
  ["kmp", { commandFor: (p) => ({ command: process.execPath, args: [fake], cwd: p.root.value, env: { ...process.env, FAKE_FLAVOR: "kmp" } }) }],
  ["made", new LazyMadeServerCommandFactory(bin, paths.madeStore(), new FsMadeConfigurationRepository(paths.madeConfigRoot()), process.env)],
]);
await HostComposition.run(process.argv[2] ?? process.cwd(), process.env, commands);
