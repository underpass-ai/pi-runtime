#!/usr/bin/env node
import { CliComposition } from "../src/composition/CliComposition.ts";

process.exit(await CliComposition.build(process.env, (s) => console.log(s)).run(process.argv.slice(2)));
