export type PiExtensionApi = {
  on(event: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean; ui: { notify(m: string, t?: string): void } }) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: { description?: string; getArgumentCompletions?: (p: string) => { value: string; label: string }[]; handler: (args: string, ctx: { cwd: string; hasUI: boolean; ui: { notify(m: string, t?: string): void } }) => Promise<void> }): void;
  getAllTools(): { name: string }[];
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
  events: { on(event: string, handler: (data: unknown) => unknown): void; emit(event: string, data: unknown): void };
};
