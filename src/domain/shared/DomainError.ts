export class DomainError extends Error {
  private constructor(message: string) { super(message); this.name = "DomainError"; }
  static because(message: string): DomainError { return new DomainError(message); }
}
