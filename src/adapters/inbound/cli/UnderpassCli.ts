import { CheckMapper } from "../../../application/mappers/CheckMapper.ts";
import type { DiagnosisReport } from "../../../domain/diagnosis/DiagnosisReport.ts";
import { CheckRenderer } from "./CheckRenderer.ts";

type Runs = { execute(record?: boolean): Promise<DiagnosisReport> };

export class UnderpassCli {
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void) { this.#setup = setup; this.#doctor = doctor; this.#print = print; }

  async run(argv: string[]): Promise<number> {
    const verb = argv[0];
    const mapper = new CheckMapper();
    const renderer = new CheckRenderer();
    const render = (report: DiagnosisReport) => renderer.render(report.checks().map((c) => mapper.toDto(c)));

    if (verb === "setup" || verb === "update") {
      const setupReport = await this.#setup.execute();
      const doctorReport = await this.#doctor.execute(verb === "setup");
      this.#print(`== setup ==\n${render(setupReport)}\n== doctor ==\n${render(doctorReport)}`);
      return setupReport.hasFailures() || doctorReport.hasFailures() ? 1 : 0;
    }
    if (verb === "doctor") {
      const doctorReport = await this.#doctor.execute(false);
      this.#print(render(doctorReport));
      return doctorReport.hasFailures() ? 1 : 0;
    }
    this.#print("usage: underpass setup | doctor | update");
    return 2;
  }
}
