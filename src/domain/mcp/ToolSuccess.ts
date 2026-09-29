export class ToolSuccess {
  readonly structured: unknown; readonly text: string;
  private constructor(s: unknown, t: string) { this.structured = s; this.text = t; }
  static of(structured: unknown, text: string): ToolSuccess { return new ToolSuccess(structured, text); }
  isSuccess(): this is ToolSuccess { return true; }
}
