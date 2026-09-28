import type { Project } from "../../domain/project/Project.ts";

export interface ProjectLocator { locate(cwd: string): Project; }
