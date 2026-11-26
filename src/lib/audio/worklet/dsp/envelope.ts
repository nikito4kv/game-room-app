/**
 * Плавная огибающая порога: множитель 0..1 по сэмплам. Порог решает «открыт /
 * закрыт» по кадрам 10 мс, а резкий скачок множителя на границе кадра слышен как
 * щелчок. Поэтому:
 *  • открытие (атака) — линейный подъём за attackMs: быстро, но без щелчка;
 *  • закрытие (отпускание) — экспоненциальный спад, за releaseMs до −40 дБ;
 *    ниже −80 дБ множитель обнуляется, чтобы в паузах была честная тишина
 *    (и Opus DTX перестаёт слать пакеты).
 */
export class GateEnvelope {
  private g = 0;
  private readonly attackStep: number;
  private readonly releaseCoef: number;

  constructor(sampleRate: number, attackMs: number, releaseMs: number) {
    this.attackStep = 1 / Math.max(1, (attackMs / 1000) * sampleRate);
    // За releaseMs множитель падает в 100 раз (−40 дБ).
    this.releaseCoef = Math.exp(Math.log(0.01) / ((releaseMs / 1000) * sampleRate));
  }

  get value(): number {
    return this.g;
  }

  /** Сразу выставить значение (без перехода) — например, при выключении порога. */
  reset(value: number): void {
    this.g = value;
  }

  /** Умножает buf[start, end) на огибающую, ведя её к target (true — открыто). */
  apply(buf: Float32Array, target: boolean, start = 0, end = buf.length): void {
    let g = this.g;
    if (target) {
      for (let i = start; i < end; i++) {
        if (g < 1) g = Math.min(1, g + this.attackStep);
        buf[i] *= g;
      }
    } else {
      for (let i = start; i < end; i++) {
        g *= this.releaseCoef;
        if (g < 1e-4) g = 0;
        buf[i] *= g;
      }
    }
    this.g = g;
  }
}
