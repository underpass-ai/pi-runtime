export type ServerCommandDto = { command: string; args: string[]; env: Record<string, string | undefined>; cwd: string };
