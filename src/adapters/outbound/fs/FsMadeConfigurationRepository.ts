import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MadeConfigurationRepository } from "../../../application/ports/MadeConfigurationRepository.ts";
import { CeremonyStoreId } from "../../../domain/made/CeremonyStoreId.ts";
import { CursorHmacKey } from "../../../domain/made/CursorHmacKey.ts";
import { MadeConfiguration } from "../../../domain/made/MadeConfiguration.ts";
import { PolicyId } from "../../../domain/made/PolicyId.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";
import { TrustedHostId } from "../../../domain/made/TrustedHostId.ts";

const KEYS = ["MADE_AUTH_POLICY_ID", "MADE_AUTH_TRUSTED_HOST_ID", "MADE_CEREMONY_STORE_ID", "MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY"];

export class FsMadeConfigurationRepository implements MadeConfigurationRepository {
  readonly #env: Record<string, string | undefined>;
  constructor(env: Record<string, string | undefined>) { this.#env = env; }

  locationOf(store: StorePath): string {
    const root = this.#env.MADE_SETUP_CONFIG_ROOT ?? join(this.#env.XDG_CONFIG_HOME ?? join(this.#env.HOME ?? "", ".config"), "underpass-made", "embedded");
    return join(root, `${store.configDigest()}.env`);
  }

  load(store: StorePath): MadeConfiguration | null {
    const path = this.locationOf(store);
    if (!existsSync(path) && !this.#isDanglingLink(path)) return null;
    const st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error(`made config ${path} must not be a symlink`);
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error(`made config ${path} must be owned by the current user`);
    const mode = st.mode & 0o777;
    if (mode !== 0o600 && mode !== 0o400) throw new Error(`made config ${path} has mode ${mode.toString(8)}; expected 600 or 400`);
    const entries = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)] as [string, string]; });
    const keys = entries.map(([k]) => k);
    if (keys.length !== 4 || KEYS.some((k) => !keys.includes(k))) throw new Error(`made config ${path} must contain exactly four keys`);
    const v = Object.fromEntries(entries);
    return MadeConfiguration.of({ policy: PolicyId.of(v.MADE_AUTH_POLICY_ID), trustedHost: TrustedHostId.of(v.MADE_AUTH_TRUSTED_HOST_ID), store: CeremonyStoreId.of(v.MADE_CEREMONY_STORE_ID), cursorKey: CursorHmacKey.of(v.MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY) });
  }

  create(store: StorePath, configuration: MadeConfiguration): void {
    const path = this.locationOf(store);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, configuration.entries().map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
  }

  #isDanglingLink(path: string): boolean { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } }
}
