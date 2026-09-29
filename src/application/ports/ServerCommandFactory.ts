import type { Project } from "../../domain/project/Project.ts";
import type { ServerCommandDto } from "../dto/ServerCommandDto.ts";

export interface ServerCommandFactory { commandFor(project: Project): ServerCommandDto; }
