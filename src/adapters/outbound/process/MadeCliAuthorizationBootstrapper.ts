import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AuthorizationBootstrapper } from "../../../application/ports/AuthorizationBootstrapper.ts";
import type { MadeConfiguration } from "../../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../../domain/made/StorePath.ts";

export class MadeCliAuthorizationBootstrapper implements AuthorizationBootstrapper {
  readonly #binary: string;
  constructor(binary: string) { this.#binary = binary; }
  async bootstrap(store: StorePath, config: MadeConfiguration): Promise<string> {
    try {
      const { stdout } = await promisify(execFile)(this.#binary, ["bootstrap-authorization", store.value, "--policy-id", config.policy.value, "--trusted-host-id", config.trustedHost.value]);
      return stdout.trim();
    } catch (e) { throw new Error(String((e as { stderr?: string }).stderr || (e as Error).message).trim()); }
  }
}
