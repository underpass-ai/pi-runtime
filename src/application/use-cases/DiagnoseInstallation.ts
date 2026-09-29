import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import { DiagnosisReport } from "../../domain/diagnosis/DiagnosisReport.ts";
import { FingerprintDrift } from "../../domain/diagnosis/FingerprintDrift.ts";
import type { SemVer } from "../../domain/distribution/SemVer.ts";
import { DeclaredLimitId } from "../../domain/made/DeclaredLimitId.ts";
import type { CatalogFingerprint } from "../../domain/mcp/CatalogFingerprint.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
import type { FingerprintRepository } from "../ports/FingerprintRepository.ts";
import type { KmpLifecycle } from "../ports/KmpLifecycle.ts";
import { MadeConfigurationError } from "../ports/MadeConfigurationError.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import type { PiPackageManager } from "../ports/PiPackageManager.ts";
import type { PiRuntimeInspector } from "../ports/PiRuntimeInspector.ts";
import type { DiscoverMadeCapabilities } from "./DiscoverMadeCapabilities.ts";
import type { VerifyPinnedBinaries } from "./VerifyPinnedBinaries.ts";
import type { VerifyServerProfiles } from "./VerifyServerProfiles.ts";

const c = (s: CheckSection, n: string, d: string) => ({ s, n: CheckName.of(n), d: CheckDetail.of(d) });

export class DiagnoseInstallation {
  readonly #verify: VerifyPinnedBinaries; readonly #runtime: PiRuntimeInspector; readonly #pi: PiPackageManager; readonly #kmp: KmpLifecycle;
  readonly #fingerprints: FingerprintRepository; readonly #connect: (s: ServerName) => Promise<McpConnection>;
  readonly #profiles: VerifyServerProfiles; readonly #capabilities: DiscoverMadeCapabilities; readonly #piVersion: SemVer;
  readonly #eventLog: { execute(): Check[] } | null;

  constructor(verify: VerifyPinnedBinaries, runtime: PiRuntimeInspector, pi: PiPackageManager, kmp: KmpLifecycle, fingerprints: FingerprintRepository,
    connect: (s: ServerName) => Promise<McpConnection>, profiles: VerifyServerProfiles, capabilities: DiscoverMadeCapabilities, piVersion: SemVer,
    eventLog: { execute(): Check[] } | null = null) {
    this.#verify = verify; this.#runtime = runtime; this.#pi = pi; this.#kmp = kmp; this.#fingerprints = fingerprints;
    this.#connect = connect; this.#profiles = profiles; this.#capabilities = capabilities; this.#piVersion = piVersion;
    this.#eventLog = eventLog;
  }

  // Los checks del log de eventos van siempre al final, también cuando la instalación corta antes (binarios sin verificar).
  async execute(record: boolean): Promise<DiagnosisReport> {
    const report = await this.#installation(record);
    if (this.#eventLog === null) return report;
    try { return report.add(...this.#eventLog.execute()); }
    catch (e) { return report.add(Check.fail(CheckSection.EVENTS, CheckName.of("event log"), CheckDetail.of((e as Error).message))); }
  }

  async #installation(record: boolean): Promise<DiagnosisReport> {
    let report = DiagnosisReport.of(await this.#piChecks());
    let binaries: Awaited<ReturnType<VerifyPinnedBinaries["execute"]>>;
    try { binaries = await this.#verify.execute(); }
    catch (e) { return report.add(Check.fail(CheckSection.HOST, CheckName.of("pinned binaries"), CheckDetail.of((e as Error).message))); }
    const broken = binaries.filter((b) => b.status !== "verified");
    if (broken.length > 0) {
      const detail = `${broken.map((b) => `${b.name} ${b.status}`).join(", ")}; run \`underpass update\``;
      return report.add(Check.fail(CheckSection.HOST, CheckName.of("pinned binaries"), CheckDetail.of(detail)));
    }
    report = report.add(Check.ok(CheckSection.HOST, CheckName.of("pinned binaries"), CheckDetail.of("verified")));

    const current = new Map<string, CatalogFingerprint>();
    for (const server of [ServerName.KMP, ServerName.MADE]) {
      let conn: McpConnection;
      try {
        conn = await this.#connect(server);
      } catch (e) {
        // Sólo la configuración privada de MADE es "private configuration"; cualquier otro fallo al arrancar es de conexión.
        const name = e instanceof MadeConfigurationError ? "private configuration" : "server connection";
        report = report.add(Check.fail(CheckSection.of(server.value), CheckName.of(name), CheckDetail.of((e as Error).message)));
        continue;
      }
      try {
        const catalog = await conn.catalog();
        current.set(server.value, catalog.fingerprint());
        for (const check of this.#profiles.execute(catalog)) {
          const x = c(CheckSection.of(server.value), `profile ${check.profile}`, check.isSatisfied() ? `${catalog.identity.version}, ${catalog.names().length} tools` : `missing ${check.missing().join(", ")}`);
          report = report.add(check.isSatisfied() ? Check.ok(x.s, x.n, x.d) : Check.fail(x.s, x.n, x.d));
        }
        if (server.equals(ServerName.MADE)) {
          const caps = await this.#capabilities.execute(conn);
          const x = c(CheckSection.MADE, "capabilities", `groups ${caps.groups.length}; limits ${caps.limits.join(", ")}`);
          report = report.add(caps.declares(DeclaredLimitId.ROSTER_PROCESS_LOCAL) ? Check.ok(x.s, x.n, x.d) : Check.warn(x.s, x.n, x.d));
        }
      } catch (e) {
        report = report.add(Check.fail(CheckSection.of(server.value), CheckName.of("server contract"), CheckDetail.of((e as Error).message)));
      } finally { await conn.close(); }
    }
    report = report.add(...FingerprintDrift.compare(this.#fingerprints.load(), current));
    if (record) this.#fingerprints.save(current);
    const healthy = await this.#kmp.doctor();
    const k = c(CheckSection.KMP, "kmp-mcp doctor", healthy ? "no FAIL" : "reported problems; run kmp-mcp doctor");
    return report.add(healthy ? Check.ok(k.s, k.n, k.d) : Check.warn(k.s, k.n, k.d));
  }

  async #piChecks(): Promise<Check[]> {
    const v = await this.#runtime.version();
    const version = !v
      ? Check.fail(CheckSection.PI, CheckName.of("pi version"), CheckDetail.of("pi not found; run scripts/install-pi.sh"))
      : v.equals(this.#piVersion)
        ? Check.ok(CheckSection.PI, CheckName.of("pi version"), CheckDetail.of(v.value))
        : Check.fail(CheckSection.PI, CheckName.of("pi version"), CheckDetail.of(`${v} (pinned ${this.#piVersion})`));
    const registered = await this.#pi.isRegistered("pi-runtime");
    const pkg = registered
      ? Check.ok(CheckSection.PI, CheckName.of("pi-runtime package"), CheckDetail.of("registered"))
      : Check.fail(CheckSection.PI, CheckName.of("pi-runtime package"), CheckDetail.of("not registered; run underpass setup"));
    return [version, pkg];
  }
}
