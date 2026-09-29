import { readFileSync } from "node:fs";

export class PackageInfo {
  private constructor() {}
  static version(): string { return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version; }
}
