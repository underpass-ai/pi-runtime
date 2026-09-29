#!/usr/bin/env node
// Uso: [UNDERPASS_MADE_MCP_BIN=…] [UNDERPASS_KMP_MCP_BIN=…] [SEED=1] [N=300] node tests/acceptance/argument-diagnostics-differential.ts
//
// Aceptación de F1, prueba diferencial contra el validador real de Pi 0.87.1 (`validateToolArguments`
// de pi-ai, con su coacción y su poda de nulls): genera argumentos a partir de cada inputSchema
// (el catálogo vivo de made-mcp/kmp-mcp si se dan los binarios, los fixtures si no), los muta
// (coacciones, nulls, claves que faltan o sobran) y comprueba la invariante que importa:
// si Pi acepta unos argumentos, prepareArguments nunca los rechaza. Informa además de cuántos
// rechazos de Pi diagnostica F1 y cuántos deja a Pi.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { PiToolFactory } from "../../src/adapters/inbound/pi/PiToolFactory.ts";
import { McpToolMapper } from "../../src/application/mappers/McpToolMapper.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import { KMP_BIN, MADE_BIN, openKmp, openMade } from "../contract/support.ts";

const prefix = process.env.PI_RUNTIME_PREFIX ?? join(process.env.HOME!, ".local/share/pi-runtime/pi-0.87.1");
const modules = join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent/node_modules");
const { validateToolArguments } = await import(pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/utils/validation.js")).href);
const { Type } = await import(pathToFileURL(join(modules, "typebox/build/index.mjs")).href);

type Schema = Record<string, any>;
const schemas: [string, Schema][] = [];
for (const [bin, open] of [[MADE_BIN, openMade], [KMP_BIN, openKmp]] as const) {
  if (!bin) continue;
  const conn = await open();
  for (const t of (await conn.catalog()).tools()) schemas.push([t.name.value, t.schema.toJson()]);
  await conn.close();
}
if (schemas.length === 0) {
  const dir = new URL("../fixtures/schemas/", import.meta.url);
  for (const f of readdirSync(dir)) schemas.push([f.replace(/\.json$/, ""), JSON.parse(readFileSync(new URL(f, dir), "utf8"))]);
}

let seed = Number(process.env.SEED ?? 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const STRINGS = ["x", "abc", "3", "true", "", "read_0123456789abcdef0123456789abcdef", "2026-09-29T10:00:00Z", "a b"];
function gen(s: Schema | boolean | undefined, depth: number): unknown {
  if (s === true || s === undefined) return pick(["x", 1, true, null, {}, []]);
  if (s === false) return "nope";
  if ("const" in s) return s.const;
  if (Array.isArray(s.enum)) return pick(s.enum);
  const alternatives: Schema[] | undefined = s.oneOf ?? s.anyOf;
  const type = Array.isArray(s.type) ? pick(s.type) : s.type ?? (s.properties ? "object" : undefined);
  switch (type) {
    case "string": { const v = pick(STRINGS); return s.minLength && v.length < s.minLength ? "x".repeat(s.minLength) : v; }
    case "integer": return (typeof s.minimum === "number" ? s.minimum : 0) + Math.floor(rnd() * 3);
    case "number": return (typeof s.minimum === "number" ? s.minimum : 0) + rnd();
    case "boolean": return rnd() < 0.5;
    case "null": return null;
    case "array": {
      if (depth > 5) return [];
      const n = Math.min(Math.max(s.minItems ?? 0, Math.floor(rnd() * 3)), s.maxItems ?? 3);
      return Array.from({ length: n }, () => gen(s.items, depth + 1));
    }
    case "object": {
      let props: Schema = s.properties ?? {}; const required: string[] = [...(s.required ?? [])];
      if (alternatives && rnd() < 0.8) { const b = pick(alternatives); props = { ...props, ...(b.properties ?? {}) }; required.push(...(b.required ?? [])); }
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) if (required.includes(k) || (depth < 5 && rnd() < 0.3)) o[k] = gen(v, depth + 1);
      for (const k of required) if (!(k in o)) o[k] = gen(props[k], depth + 1);
      if (s.additionalProperties && typeof s.additionalProperties === "object" && rnd() < 0.3) o.extra_key = gen(s.additionalProperties, depth + 1);
      return o;
    }
    default: return alternatives ? gen(pick(alternatives), depth) : "x";
  }
}
function mutate(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(mutate);
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const r = rnd(); if (r < 0.05) continue; o[k] = r < 0.1 ? null : mutate(x); }
    if (rnd() < 0.05) o.zz_unknown = 1;
    return o;
  }
  const r = rnd();
  if ((typeof v === "number" || typeof v === "boolean") && r < 0.2) return String(v);
  if (typeof v === "string" && r < 0.1) return 7;
  return r < 0.25 ? null : v;
}

const n = Number(process.env.N ?? 300);
const tally = { tools: schemas.length, piAccepted: 0, piRejected: 0, diagnosed: 0, leftToPi: 0, falsePositives: 0 };
const falsePositives: string[] = [];
for (const [name, schema] of schemas) {
  const tool = new PiToolFactory((j) => Type.Unsafe(j)).create(ServerName.KMP, new McpToolMapper().toDomain({ name, inputSchema: schema }), async () => { throw new Error("not called"); });
  for (let i = 0; i < n; i++) {
    let args = gen(schema, 0); if (rnd() < 0.6) args = mutate(args);
    let piAccepts = true; try { validateToolArguments(tool, { name, arguments: structuredClone(args) }); } catch { piAccepts = false; }
    let diagnosis: string | null = null; try { tool.prepareArguments(structuredClone(args)); } catch (e) { diagnosis = (e as Error).message; }
    if (piAccepts) {
      tally.piAccepted++;
      if (diagnosis !== null) { tally.falsePositives++; if (falsePositives.length < 5) falsePositives.push(`${name} ${JSON.stringify(args)}\n${diagnosis}`); }
    } else { tally.piRejected++; if (diagnosis !== null) tally.diagnosed++; else tally.leftToPi++; }
  }
}
console.log(JSON.stringify({ seed: Number(process.env.SEED ?? 1), perTool: n, ...tally }, null, 2));
for (const f of falsePositives) console.log(`\nfalse positive: ${f}`);
process.exit(tally.falsePositives === 0 ? 0 : 1);
