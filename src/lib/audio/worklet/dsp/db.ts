/**
 * Перевод уровней в децибелы и обратно. Всё в дБ относительно полной шкалы (дБFS):
 * 0 дБ — максимальная амплитуда ±1, −20 дБ — в 10 раз тише.
 */

/** Пол уровня: тише этого считаем тишиной (и не уходим в −Infinity). */
export const SILENCE_DB = -100;

/** Мощность (средний квадрат) → дБ. Ноль и почти ноль дают SILENCE_DB. */
export function powerToDb(power: number): number {
  return power > 1e-10 ? 10 * Math.log10(power) : SILENCE_DB;
}

/** Амплитудный множитель → дБ. */
export function gainToDb(gain: number): number {
  return gain > 1e-5 ? 20 * Math.log10(gain) : SILENCE_DB;
}

/** дБ → амплитудный множитель. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Средний квадрат куска буфера [start, end). */
export function meanSquare(buf: Float32Array, start = 0, end = buf.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += buf[i] * buf[i];
  return end > start ? sum / (end - start) : 0;
}

/** RMS-уровень куска буфера в дБFS. */
export function rmsDb(buf: Float32Array, start = 0, end = buf.length): number {
  return powerToDb(meanSquare(buf, start, end));
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
