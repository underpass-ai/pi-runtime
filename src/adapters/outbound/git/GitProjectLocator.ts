import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { ProjectLocator } from "../../../application/ports/ProjectLocator.ts";
import { Project } from "../../../domain/project/Project.ts";
import { ProjectRoot } from "../../../domain/project/ProjectRoot.ts";

export class GitProjectLocator implements ProjectLocator {
  locate(cwd: string): Project {
    let root = cwd;
    try { root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { /* no es un repo: el directorio es el proyecto */ }
    return Project.of(ProjectRoot.of(realpathSync(root)));
  }
}
