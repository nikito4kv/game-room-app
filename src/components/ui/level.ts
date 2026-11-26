// Математика индикатора уровня (LevelMeter): перевод дБ ↔ доля полосы,
// сглаживание «быстро вверх, плавно вниз» и метка пика. Всё в дБFS
// (0 — максимум, тишина → −∞), как у порога шумового гейта.

/** Нижняя граница шкалы по умолчанию: тише −60 дБFS полоса пустая. */
export const METER_MIN_DB = -60;
export const METER_MAX_DB = 0;

/** Доля заполнения полосы 0…1 для уровня в дБ (линейно в дБ). */
export function dbToFraction(db: number, minDb = METER_MIN_DB, maxDb = METER_MAX_DB): number {
  if (!Number.isFinite(db)) return db > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
}

/** Обратное преобразование: позиция на полосе 0…1 → дБ. */
export function fractionToDb(f: number, minDb = METER_MIN_DB, maxDb = METER_MAX_DB): number {
  const clamped = Math.min(1, Math.max(0, f));
  return minDb + clamped * (maxDb - minDb);
}

/** RMS сигнала 0…1 → дБFS. Ноль даёт −∞ (полоса пустая). */
export function rmsToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/**
 * Сглаживание отображаемого уровня между кадрами: рост — мгновенно (не
 * опаздываем за голосом), спад — не быстрее `releaseDbPerSec`, чтобы полоса не
 * дёргалась на каждом слоге.
 */
export function smoothLevelDb(prevDb: number, targetDb: number, dtMs: number, releaseDbPerSec = 36): number {
  if (!Number.isFinite(prevDb) || targetDb >= prevDb) return targetDb;
  const fallen = prevDb - (releaseDbPerSec * Math.max(0, dtMs)) / 1000;
  return Math.max(targetDb, fallen);
}

export type PeakState = { db: number; heldMs: number };

/**
 * Метка пика: держится `holdMs` после максимума, потом опускается со
 * скоростью `fallDbPerSec`, но не ниже текущего уровня.
 */
export function nextPeak(
  prev: PeakState,
  levelDb: number,
  dtMs: number,
  holdMs = 700,
  fallDbPerSec = 18,
): PeakState {
  if (!Number.isFinite(prev.db) || levelDb >= prev.db) return { db: levelDb, heldMs: 0 };
  const heldMs = prev.heldMs + Math.max(0, dtMs);
  if (heldMs < holdMs) return { db: prev.db, heldMs };
  const fallen = prev.db - (fallDbPerSec * Math.max(0, dtMs)) / 1000;
  return { db: Math.max(levelDb, fallen), heldMs };
}

/** «−42 дБ» — с настоящим знаком минуса и неразрывным пробелом. */
export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return "−∞ дБ";
  const r = Math.round(db);
  return `${r < 0 ? "−" : ""}${Math.abs(r)} дБ`;
}
