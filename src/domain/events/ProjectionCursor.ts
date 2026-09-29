import { DomainError } from "../shared/DomainError.ts";
import type { GlobalPosition } from "./GlobalPosition.ts";

export class ProjectionCursor {
  readonly version: number; readonly position: GlobalPosition;
  private constructor(version: number, position: GlobalPosition) { this.version = version; this.position = position; }
  static of(version: number, position: GlobalPosition): ProjectionCursor {
    if (!Number.isInteger(version) || version < 1) throw DomainError.because(`invalid projection version ${version}`);
    return new ProjectionCursor(version, position);
  }
}
