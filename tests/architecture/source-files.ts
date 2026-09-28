import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = new URL("../../", import.meta.url).pathname;

export function sourceFiles(dir = join(ROOT, "src")): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [{ path: relative(ROOT, full), text: readFileSync(full, "utf8") }] : [];
  });
}

export function importsOf(text: string): string[] {
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}
