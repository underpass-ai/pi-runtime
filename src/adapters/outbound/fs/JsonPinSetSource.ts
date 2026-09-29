import { readFileSync } from "node:fs";
import type { PinSetSource } from "../../../application/ports/PinSetSource.ts";
import { PinSetMapper } from "../../../application/mappers/PinSetMapper.ts";
import type { PinSet } from "../../../domain/distribution/PinSet.ts";

export class JsonPinSetSource implements PinSetSource {
  readonly #file: string;
  constructor(file: string) { this.#file = file; }
  load(): PinSet { return new PinSetMapper().toDomain(JSON.parse(readFileSync(this.#file, "utf8"))); }
}
