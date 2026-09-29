export abstract class ValueObject<T> {
  readonly #value: T;
  protected constructor(value: T) { this.#value = value; }
  get value(): T { return this.#value; }
  equals(other: ValueObject<T>): boolean { return other.constructor === this.constructor && other.value === this.value; }
  toString(): string { return String(this.#value); }
}
