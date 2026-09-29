#!/usr/bin/env node
import { HostComposition } from "../src/composition/HostComposition.ts";

await HostComposition.run(process.argv[2] ?? process.cwd(), process.env);
