import { dbToGain, gainToDb } from "./db";

/**
 * Мягкий лимитер с упреждением: на усилении 200 % громкий голос иначе вылезает
 * за 0 дБFS и хрипит при кодировании. Лимитер «видит» пики на lookahead вперёд и
 * заранее плавно опускает громкость так, что к пику она уже достаточна, — без
 * перерегулирования и без щелчков. Отпускание — экспоненциальное, releaseMs.
 *
 * Устройство (классика «минимум окна + сглаживание»):
 *  1) для каждого входного сэмпла — нужный множитель r = min(1, потолок/|x|);
 *  2) минимум r по окну W+1 последних сэмплов (с учётом задержки звука на W это
 *     окно «будущего» для выходного сэмпла);
 *  3) спад — мгновенно, рост — плавно (отпускание);
 *  4) скользящее среднее за W сэмплов превращает ступеньки в линейные рампы.
 * Среднее W значений, каждое из которых не больше r пика, само не больше r пика, —
 * поэтому выход гарантированно не превышает потолок.
 */
export class LookaheadLimiter {
  readonly latency: number;
  private readonly ceiling: number;
  private readonly releaseCoef: number;
  // Задержка звука на W сэмплов.
  private readonly delay: Float32Array;
  private delayPos = 0;
  // Скользящий минимум по окну W+1 — монотонная очередь (индексы и значения).
  private readonly dqIdx: Float64Array;
  private readonly dqVal: Float64Array;
  private dqHead = 0;
  private dqTail = 0;
  private n = 0;
  // Отпускание и скользящее среднее (окно W).
  private held = 1;
  private readonly box: Float64Array;
  private boxPos = 0;
  private boxSum: number;
  private minGain = 1;

  constructor(sampleRate: number, ceilingDb = -1, lookaheadMs = 1, releaseMs = 60) {
    const w = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
    this.latency = w;
    this.ceiling = dbToGain(ceilingDb);
    this.releaseCoef = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
    this.delay = new Float32Array(w);
    this.dqIdx = new Float64Array(w + 2);
    this.dqVal = new Float64Array(w + 2);
    this.box = new Float64Array(w).fill(1);
    this.boxSum = w;
  }

  /** Наибольшее ослабление с прошлого вызова, дБ (≤ 0); для индикатора перегруза. */
  takeReductionDb(): number {
    const db = gainToDb(this.minGain);
    this.minGain = 1;
    return db;
  }

  /** Обрабатывает буфер на месте; выход задержан на latency сэмплов. */
  process(buf: Float32Array): void {
    const w = this.latency;
    const cap = this.dqIdx.length;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const ax = Math.abs(x);
      const r = ax > this.ceiling ? this.ceiling / ax : 1;

      // 2) скользящий минимум r за последние W+1 сэмплов
      const n = this.n++;
      while (this.dqTail !== this.dqHead) {
        const last = this.dqTail === 0 ? cap - 1 : this.dqTail - 1;
        if (this.dqVal[last] < r) break;
        this.dqTail = last;
      }
      this.dqIdx[this.dqTail] = n;
      this.dqVal[this.dqTail] = r;
      this.dqTail = this.dqTail + 1 === cap ? 0 : this.dqTail + 1;
      if (this.dqIdx[this.dqHead] < n - w) this.dqHead = this.dqHead + 1 === cap ? 0 : this.dqHead + 1;
      const m = this.dqVal[this.dqHead];

      // 3) спад мгновенно, рост — с отпусканием (у самой цели — защёлкиваем)
      if (m < this.held || m - this.held < 1e-6) this.held = m;
      else this.held = m - (m - this.held) * this.releaseCoef;

      // 4) скользящее среднее за W
      this.boxSum += this.held - this.box[this.boxPos];
      this.box[this.boxPos] = this.held;
      this.boxPos = this.boxPos + 1 === w ? 0 : this.boxPos + 1;
      // Сумма единиц копит ошибку округления — в «тихом» режиме сбрасываем её точно.
      if (this.held === 1 && this.boxSum > w - 1e-9) this.boxSum = w;
      const g = Math.min(1, this.boxSum / w);
      if (g < this.minGain) this.minGain = g;

      const delayed = this.delay[this.delayPos];
      this.delay[this.delayPos] = x;
      this.delayPos = this.delayPos + 1 === w ? 0 : this.delayPos + 1;
      // Страховка от ошибок округления: потолок не пересекаем никогда.
      const y = delayed * g;
      buf[i] = y > this.ceiling ? this.ceiling : y < -this.ceiling ? -this.ceiling : y;
    }
  }
}
