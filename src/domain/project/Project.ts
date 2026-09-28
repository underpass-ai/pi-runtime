import { ProjectId } from "./ProjectId.ts";
import type { ProjectRoot } from "./ProjectRoot.ts";

export class Project {
  readonly root: ProjectRoot; readonly id: ProjectId;
  private constructor(root: ProjectRoot) { this.root = root; this.id = ProjectId.derive(root); }
  static of(root: ProjectRoot): Project { return new Project(root); }
}
