import { DomainError } from "../shared/DomainError.ts";
import type { BinaryName } from "./BinaryName.ts";
import type { BinaryPin } from "./BinaryPin.ts";
import type { PiPin } from "./PiPin.ts";

export class PinSet {
  readonly pi: PiPin;
  readonly #binaries: BinaryPin[];
  private constructor(pi: PiPin, binaries: BinaryPin[]) { this.pi = pi; this.#binaries = binaries; }

  static of(pi: PiPin, binaries: BinaryPin[]): PinSet {
    const names = binaries.map((b) => b.name.value);
    if (new Set(names).size !== names.length) throw DomainError.because("duplicate binary pin");
    return new PinSet(pi, binaries);
  }

  pinFor(name: BinaryName): BinaryPin {
    const pin = this.#binaries.find((b) => b.name.equals(name));
    if (!pin) throw DomainError.because(`no pin for ${name}`);
    return pin;
  }

  binaries(): BinaryPin[] { return [...this.#binaries]; }
}
