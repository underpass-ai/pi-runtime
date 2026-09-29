import { DomainError } from "../shared/DomainError.ts";

const BOUNDS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

// Histograma de duración con los límites fijos de la spec. `buckets[i]` cuenta las
// observaciones en (BOUNDS[i-1], BOUNDS[i]] (no acumulado); las que pasan del último
// límite sólo cuentan en `count`. Inmutable.
export class HistogramValue {
  static readonly BOUNDS: readonly number[] = BOUNDS;
  static readonly EMPTY = new HistogramValue(BOUNDS.map(() => 0), 0, 0);
  readonly buckets: readonly number[]; readonly sum: number; readonly count: number;
  private constructor(buckets: number[], sum: number, count: number) { this.buckets = buckets; this.sum = sum; this.count = count; }

  static fromJson(raw: unknown): HistogramValue {
    const o = (raw ?? {}) as { buckets?: unknown; sum?: unknown; count?: unknown };
    const buckets = Array.isArray(o.buckets) ? (o.buckets as unknown[]) : [];
    if (typeof raw !== "object" || raw === null || buckets.length !== BOUNDS.length || !buckets.every(isCount)
      || typeof o.sum !== "number" || !Number.isFinite(o.sum) || !isCount(o.count)
      || (buckets as number[]).reduce((a, b) => a + b, 0) > (o.count as number)) throw DomainError.because("invalid histogram state");
    return new HistogramValue([...(buckets as number[])], o.sum, o.count as number);
  }

  observe(ms: number): HistogramValue {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw DomainError.because(`invalid observation ${ms}`);
    const i = BOUNDS.findIndex((b) => ms <= b);
    const buckets = [...this.buckets];
    if (i >= 0) buckets[i]++;
    return new HistogramValue(buckets, this.sum + ms, this.count + 1);
  }

  toJson(): { buckets: number[]; sum: number; count: number } { return { buckets: [...this.buckets], sum: this.sum, count: this.count }; }

  // Los 12 cubos de OTLP (explicitBounds.length + 1), no acumulados; el último es el desbordamiento.
  bucketCounts(): number[] { return [...this.buckets, this.count - this.buckets.reduce((a, b) => a + b, 0)]; }

  // Acumulados por límite, como los `_bucket{le}` de Prometheus; el último (+Inf) es count.
  cumulative(): number[] { let acc = 0; return this.bucketCounts().map((n) => (acc += n)); }

  // Estimación local: el límite superior del cubo que contiene el rango q; Infinity si cae en el desbordamiento.
  quantile(q: number): number | null {
    if (this.count === 0) return null;
    const rank = Math.max(1, Math.ceil(q * this.count));
    const i = this.cumulative().findIndex((c) => c >= rank);
    return i < BOUNDS.length ? BOUNDS[i] : Number.POSITIVE_INFINITY;
  }
}
