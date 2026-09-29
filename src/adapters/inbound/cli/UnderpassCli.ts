import { CheckMapper } from "../../../application/mappers/CheckMapper.ts";
import type { DiagnosisReport } from "../../../domain/diagnosis/DiagnosisReport.ts";
import { CheckRenderer } from "./CheckRenderer.ts";

type Runs = { execute(record?: boolean): Promise<DiagnosisReport> };
type Events = { run(args: string[]): number };
const USAGE = "usage: underpass setup | doctor | update | events <sessions|show|tools|verify|export|import|rebuild>";

export class UnderpassCli {
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void; readonly #events: Events | null;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void, events: Events | null = null) {
    this.#setup = setup; this.#doctor = doctor; this.#print = print; this.#events = events;
  }

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
    if (verb === "events" && this.#events !== null) return this.#events.run(argv.slice(1));
    this.#print(USAGE);
    return 2;
  }
}
