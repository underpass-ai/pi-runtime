#!/usr/bin/env node
import { HostComposition } from "../../src/composition/HostComposition.ts";
import type { ServerCommandFactory } from "../../src/application/ports/ServerCommandFactory.ts";

const raw = process.env.FAKE_SERVER_CMD;
if (!raw) throw new Error("FAKE_SERVER_CMD is required by test-host.ts");
const [command, ...args] = raw.split(" ");
const fake = (flavor: string): ServerCommandFactory => ({
  commandFor: (p) => ({ command, args, cwd: p.root.value, env: { ...process.env, FAKE_FLAVOR: flavor } }),
});
const commands = new Map<string, ServerCommandFactory>([["kmp", fake("kmp")], ["made", fake("made")]]);

await HostComposition.run(process.argv[2] ?? process.cwd(), process.env, commands);
