import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MadeConfigurationRepository } from "../../../application/ports/MadeConfigurationRepository.ts";
import { CeremonyStoreId } from "../../../domain/made/CeremonyStoreId.ts";
import { CursorHmacKey } from "../../../domain/made/CursorHmacKey.ts";
import { MadeConfiguration } from "../../../domain/made/MadeConfiguration.ts";
import { PolicyId } from "../../../domain/made/PolicyId.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";
import { TrustedHostId } from "../../../domain/made/TrustedHostId.ts";

const KEYS = ["MADE_AUTH_POLICY_ID", "MADE_AUTH_TRUSTED_HOST_ID", "MADE_CEREMONY_STORE_ID", "MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY"];
const HEADER = "# MADE embedded host configuration; managed by made-setup.";

export class FsMadeConfigurationRepository implements MadeConfigurationRepository {
  readonly #env: Record<string, string | undefined>;
  constructor(env: Record<string, string | undefined>) { this.#env = env; }

  locationOf(store: StorePath): string {
    const root = this.#env.MADE_SETUP_CONFIG_ROOT ?? join(this.#env.XDG_CONFIG_HOME ?? join(this.#env.HOME ?? "", ".config"), "underpass-made", "embedded");
    return join(root, `${store.configDigest()}.env`);
  }

  load(store: StorePath): MadeConfiguration | null {
    const path = this.locationOf(store);
    const dir = dirname(path);
    if (!this.#dirExists(dir)) return null;
    this.#assertDirSecure(dir);

    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ENOENT") return null;
      if (code === "ELOOP") throw new Error(`made config ${path} must not be a symlink`);
      throw e;
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) throw new Error(`made config ${path} must be a regular file`);
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error(`made config ${path} must be owned by the current user`);
      const mode = st.mode & 0o777;
      if (mode !== 0o600 && mode !== 0o400) throw new Error(`made config ${path} has mode ${mode.toString(8)}; expected 600 or 400`);
      const seen = new Map<string, string>();
      for (const line of readFileSync(fd, "utf8").split("\n")) {
        if (line === "" || line.startsWith("#")) continue;
        const i = line.indexOf("=");
        if (i === -1 || !line.startsWith("MADE_")) throw new Error(`malformed line in made config ${path}`);
        const key = line.slice(0, i);
        const value = line.slice(i + 1);
        if (!KEYS.includes(key)) throw new Error(`made config ${path} contains an unknown key ${key}`);
        if (seen.has(key)) throw new Error(`made config ${path} must contain exactly four keys`);
        seen.set(key, value);
      }
      if (seen.size !== 4) throw new Error(`made config ${path} must contain exactly four keys`);
      return MadeConfiguration.of({ policy: PolicyId.of(seen.get("MADE_AUTH_POLICY_ID")!), trustedHost: TrustedHostId.of(seen.get("MADE_AUTH_TRUSTED_HOST_ID")!), store: CeremonyStoreId.of(seen.get("MADE_CEREMONY_STORE_ID")!), cursorKey: CursorHmacKey.of(seen.get("MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY")!) });
    } finally {
      closeSync(fd);
    }
  }

  create(store: StorePath, configuration: MadeConfiguration): void {
    const path = this.locationOf(store);
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#assertDirSecure(dir);
    writeFileSync(path, [HEADER, ...configuration.entries().map(([k, v]) => `${k}=${v}`)].join("\n") + "\n", { mode: 0o600, flag: "wx" });
  }

  #dirExists(dir: string): boolean { try { return statSync(dir).isDirectory(); } catch { return false; } }

  #assertDirSecure(dir: string): void {
    const st = statSync(dir);
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error(`made config directory ${dir} must be owned by the current user`);
    if ((st.mode & 0o022) !== 0) throw new Error(`made config directory ${dir} must not be writable by group or others`);
  }
}
