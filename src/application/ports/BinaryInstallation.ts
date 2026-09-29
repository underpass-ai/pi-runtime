import type { BinaryPin } from "../../domain/distribution/BinaryPin.ts";

export interface BinaryInstallation {
  pathOf(pin: BinaryPin): string;
  stagingPathOf(pin: BinaryPin): string;
  exists(pin: BinaryPin): boolean;
  commit(pin: BinaryPin): void;
  discard(pin: BinaryPin): void;
}
