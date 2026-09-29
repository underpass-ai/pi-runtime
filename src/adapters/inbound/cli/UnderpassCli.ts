import { CheckMapper } from "../../../application/mappers/CheckMapper.ts";
import type { DiagnosisReport } from "../../../domain/diagnosis/DiagnosisReport.ts";
import { CheckRenderer } from "./CheckRenderer.ts";

type Runs = { execute(record?: boolean): Promise<DiagnosisReport> };
type Verb = { run(args: string[]): number };
type AsyncVerb = { run(args: string[]): Promise<number> };
const USAGE = "usage: underpass setup | doctor | update | events <sessions|show|tools|kpis|trace|verify|export|import|rebuild|ack-gaps> | learning <report|mode> | made <grants|revoke-orphans> | metrics [--session <id>]";

export class UnderpassCli {
  readonly #setup: Runs; readonly #doctor: Runs; readonly #print: (s: string) => void; readonly #events: Verb | null; readonly #metrics: Verb | null;
  readonly #learning: Verb | null; readonly #made: AsyncVerb | null;
  constructor(setup: Runs, doctor: Runs, print: (s: string) => void, events: Verb | null = null, metrics: Verb | null = null, learning: Verb | null = null, made: AsyncVerb | null = null) {
    this.#setup = setup; this.#doctor = doctor; this.#print = print; this.#events = events; this.#metrics = metrics; this.#learning = learning; this.#made = made;
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
    if (verb === "metrics" && this.#metrics !== null) return this.#metrics.run(argv.slice(1));
    if (verb === "learning" && this.#learning !== null) return this.#learning.run(argv.slice(1));
    if (verb === "made" && this.#made !== null) return this.#made.run(argv.slice(1));
    this.#print(USAGE);
    return 2;
  }
}
