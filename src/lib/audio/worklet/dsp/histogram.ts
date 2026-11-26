/**
 * Гистограмма уровней в дБ с экспоненциальным забыванием. Из неё берём
 * процентили: нижний — уровень фона, верхний — уровень своего голоса. Историю
 * не храним: старые значения плавно теряют вес (за halfLife добавлений — вдвое).
 *
 * Забывание «ленивое»: вместо умножения всех корзин на каждом шаге растёт вес
 * новых значений, а раз в долгое время всё перенормируется. Шаг — O(1),
 * процентиль — один проход по корзинам.
 */
export class DecayingHistogram {
  private readonly bins: Float64Array;
  private readonly growth: number;
  private scale = 1;
  private mass = 0;

  constructor(
    private readonly minDb: number,
    private readonly maxDb: number,
    private readonly binDb: number,
    halfLife: number,
  ) {
    this.bins = new Float64Array(Math.ceil((maxDb - minDb) / binDb));
    this.growth = Math.pow(2, 1 / halfLife);
  }

  /** Добавить значение (дБ) с весом. Значения вне диапазона прижимаются к краю. */
  add(db: number, weight = 1): void {
    this.scale *= this.growth;
    const w = weight * this.scale;
    const pos = Math.floor((db - this.minDb) / this.binDb);
    const idx = pos < 0 ? 0 : pos >= this.bins.length ? this.bins.length - 1 : pos;
    this.bins[idx] += w;
    this.mass += w;
    if (this.scale > 1e100) this.renormalize();
  }

  /** Суммарный «свежий» вес: сколько значений набралось с учётом забывания. */
  get weight(): number {
    return this.mass / this.scale;
  }

  /**
   * Процентиль p (0..1) в дБ с линейной интерполяцией внутри корзины.
   * NaN, если данных нет.
   */
  percentile(p: number): number {
    if (this.mass <= 0) return NaN;
    const target = p * this.mass;
    let acc = 0;
    for (let i = 0; i < this.bins.length; i++) {
      const b = this.bins[i];
      if (b > 0 && acc + b >= target) {
        const frac = (target - acc) / b;
        return this.minDb + (i + frac) * this.binDb;
      }
      acc += b;
    }
    return this.maxDb;
  }

  clear(): void {
    this.bins.fill(0);
    this.mass = 0;
    this.scale = 1;
  }

  private renormalize(): void {
    for (let i = 0; i < this.bins.length; i++) this.bins[i] /= this.scale;
    this.mass /= this.scale;
    this.scale = 1;
  }
}
