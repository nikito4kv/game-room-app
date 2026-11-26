import { clamp } from "./db";

/**
 * Своя автогромкость голоса — вместо браузерной. Браузерная (AGC2 в Chrome)
 * слушает всё подряд и в ваших паузах вытягивает соседей до «нормальной
 * громкости». Эта:
 *  • берёт уровень вашего голоса из оценки умного порога (верхний процентиль
 *    своей речи, с защитой от далёких голосов), а не из всего, что слышит;
 *  • двигает усиление только на кадрах вашей речи (порог открыт, VAD уверена),
 *    в паузах оно стоит на месте — фон между словами не «всплывает»;
 *  • убавляет быстро (громкий голос не оглушает друзей), прибавляет медленно —
 *    без «качания».
 */
export type AgcTuning = {
  /** Целевой уровень речи (средний по активной речи), дБFS. */
  targetDb: number;
  /** На сколько верхний процентиль кадров речи (оценка порога) выше среднего уровня речи. */
  p90AboveActiveDb: number;
  /** Пределы усиления. */
  maxGainDb: number;
  minGainDb: number;
  /** Скорость прибавления и убавления усиления, дБ/с. */
  riseDbPerSec: number;
  fallDbPerSec: number;
};

export const DEFAULT_AGC_TUNING: AgcTuning = {
  targetDb: -18,
  p90AboveActiveDb: 4,
  maxGainDb: 12,
  minGainDb: -10,
  riseDbPerSec: 2,
  fallDbPerSec: 10,
};

export class VoiceAgc {
  readonly tuning: AgcTuning;
  private readonly frameSec: number;
  private gain = 0;

  constructor(frameMs: number, tuning: Partial<AgcTuning> = {}) {
    this.tuning = { ...DEFAULT_AGC_TUNING, ...tuning };
    this.frameSec = frameMs / 1000;
  }

  /** Текущее усиление автогромкости, дБ. */
  get gainDb(): number {
    return this.gain;
  }

  /**
   * voiceDb — оценка своего голоса от порога (NaN — ещё не выучен); ownSpeech —
   * этот кадр ваша речь; enabled — автогромкость включена. Выключенная плавно
   * (за ~1 с) возвращается к 0 дБ. Возвращает усиление в дБ.
   */
  update(voiceDb: number, ownSpeech: boolean, enabled: boolean): number {
    const t = this.tuning;
    const known = enabled && Number.isFinite(voiceDb);
    const desired = known ? clamp(t.targetDb + t.p90AboveActiveDb - voiceDb, t.minGainDb, t.maxGainDb) : 0;
    if ((known && ownSpeech) || !enabled) {
      const diff = desired - this.gain;
      const rate = diff < 0 || !enabled ? t.fallDbPerSec : t.riseDbPerSec;
      const step = rate * this.frameSec;
      // У цели — защёлкиваем точно (без накопления ошибок округления).
      this.gain = Math.abs(diff) <= step + 1e-9 ? desired : this.gain + Math.sign(diff) * step;
    }
    return this.gain;
  }
}
