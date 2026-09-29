import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import type { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import type { AuthorizationBootstrapper } from "../ports/AuthorizationBootstrapper.ts";

export class BootstrapMadeAuthorization {
  readonly #bootstrapper: AuthorizationBootstrapper;
  constructor(b: AuthorizationBootstrapper) { this.#bootstrapper = b; }
  async execute(store: StorePath, config: MadeConfiguration): Promise<Check> {
    const name = CheckName.of("authorization bootstrap");
    try { return Check.ok(CheckSection.MADE, name, CheckDetail.of(await this.#bootstrapper.bootstrap(store, config))); }
    catch (e) { return Check.fail(CheckSection.MADE, name, CheckDetail.of((e as Error).message)); }
  }
}
