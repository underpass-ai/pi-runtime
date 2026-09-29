import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import { DiagnosisReport } from "../../domain/diagnosis/DiagnosisReport.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import type { PiPackageManager } from "../ports/PiPackageManager.ts";
import type { BootstrapMadeAuthorization } from "./BootstrapMadeAuthorization.ts";
import type { EnsureMadeConfiguration } from "./EnsureMadeConfiguration.ts";
import type { InstallPinnedBinaries } from "./InstallPinnedBinaries.ts";

const step = async (section: CheckSection, name: string, run: () => Promise<string>): Promise<Check> => {
  try { return Check.ok(section, CheckName.of(name), CheckDetail.of(await run())); }
  catch (e) { return Check.fail(section, CheckName.of(name), CheckDetail.of((e as Error).message)); }
};

export class SetupInstallation {
  readonly #install: InstallPinnedBinaries; readonly #ensure: EnsureMadeConfiguration; readonly #bootstrap: BootstrapMadeAuthorization;
  readonly #pi: PiPackageManager; readonly #store: StorePath; readonly #packageDir: string;

  constructor(install: InstallPinnedBinaries, ensure: EnsureMadeConfiguration, bootstrap: BootstrapMadeAuthorization, pi: PiPackageManager, store: StorePath, packageDir: string) {
    this.#install = install; this.#ensure = ensure; this.#bootstrap = bootstrap; this.#pi = pi; this.#store = store; this.#packageDir = packageDir;
  }

  async execute(): Promise<DiagnosisReport> {
    const binaries = await step(CheckSection.HOST, "pinned binaries", async () => (await this.#install.execute()).map((r) => `${r.name} ${r.action}`).join(", ") || "none");
    let report = DiagnosisReport.of([binaries]);
    if (report.hasFailures()) return report;
    let ensured: ReturnType<EnsureMadeConfiguration["execute"]>;
    try {
      ensured = this.#ensure.execute(this.#store);
    } catch (e) {
      return report.add(Check.fail(CheckSection.MADE, CheckName.of("private configuration"), CheckDetail.of((e as Error).message)));
    }
    report = report.add(Check.ok(CheckSection.MADE, CheckName.of("private configuration"), CheckDetail.of(`${ensured.created ? "created" : "reused"} ${ensured.location} (key redacted)`)));
    report = report.add(await this.#bootstrap.execute(this.#store, ensured.configuration));
    // Sin paso `kmp-mcp setup`: sin flag de host reconcilia los hosts de KMP
    // de Claude/Codex del usuario. Llegará como `kmp-mcp setup --pi` con la
    // release de KMP Host::Pi, y DESPUÉS de `pi install`.
    return report.add(await step(CheckSection.PI, "pi-runtime package", async () => { await this.#pi.install(this.#packageDir); return `pi install ${this.#packageDir}`; }));
  }
}
