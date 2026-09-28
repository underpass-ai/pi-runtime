import type { Project } from "../../domain/project/Project.ts";

export interface HostLauncher { launch(project: Project): void; }
