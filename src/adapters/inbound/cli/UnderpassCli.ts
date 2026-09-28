import { CheckMapper } from "../../../application/mappers/CheckMapper.ts";
import type { DiagnosisReport } from "../../../domain/diagnosis/DiagnosisReport.ts";
import { CheckRenderer } from "./CheckRenderer.ts";

type Runs = { execute(record?: boolean): Promise<DiagnosisReport> };

export class UnderpassCli {
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void) { this.#setup = setup; this.#doctor = doctor; this.#print = print; }

  async run(argv: string[]): Promise<number> {
    const verb = argv[0];
    let report: DiagnosisReport;
    if (verb === "setup") report = (await this.#setup.execute()).merge(await this.#doctor.execute(true));
    else if (verb === "update") report = (await this.#setup.execute()).merge(await this.#doctor.execute(false));
    else if (verb === "doctor") report = await this.#doctor.execute(false);
    else { this.#print("usage: underpass setup | doctor | update"); return 2; }
    const mapper = new CheckMapper();
    this.#print(new CheckRenderer().render(report.checks().map((c) => mapper.toDto(c))));
    return report.hasFailures() ? 1 : 0;
  }
}
