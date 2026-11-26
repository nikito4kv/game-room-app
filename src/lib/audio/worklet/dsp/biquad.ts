/**
 * Биквад-фильтр второго порядка (формулы RBJ Audio EQ Cookbook), прямая форма I.
 * Состояние держим в обычных числах JS (double): на тихом сигнале float32-состояние
 * уходило бы в денормалы и шумело бы ошибками округления.
 */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  /**
   * ФВЧ (срез низа). По умолчанию Баттерворт (Q = 1/√2): ровная АЧХ в полосе
   * голоса, −3 дБ на частоте среза, дальше −12 дБ на октаву.
   */
  static highpass(sampleRate: number, cutoffHz: number, q = Math.SQRT1_2): Biquad {
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(
      (1 + cos) / 2 / a0,
      -(1 + cos) / a0,
      (1 + cos) / 2 / a0,
      (-2 * cos) / a0,
      (1 - alpha) / a0,
    );
  }

  /** Фильтрует буфер на месте. */
  process(buf: Float32Array): void {
    const { b0, b1, b2, a1, a2 } = this;
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      buf[i] = y;
    }
    // В полной тишине хвост состояния затухает до денормалов — обнуляем его.
    if (Math.abs(y1) < 1e-25 && Math.abs(y2) < 1e-25) y1 = y2 = 0;
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
  }
}
