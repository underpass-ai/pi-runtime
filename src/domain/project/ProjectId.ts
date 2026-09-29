import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { ProjectRoot } from "./ProjectRoot.ts";

export class ProjectId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ProjectId {
    if (typeof raw !== "string" || !/^[0-9a-f]{16}$/.test(raw)) throw DomainError.because("project id must be 16 hex characters");
    return new ProjectId(raw);
  }
  static derive(root: ProjectRoot): ProjectId { return new ProjectId(createHash("sha256").update(root.value).digest("hex").slice(0, 16)); }
}
