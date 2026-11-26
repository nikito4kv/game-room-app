// Форматирование чисел и времени для экрана и отчёта. Без зависимостей от браузера.

const KB = 1024;
const MB = 1024 * 1024;

function decimalComma(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

/** 16384 → «16 КБ», 1048576 → «1 МБ», 1572864 → «1,5 МБ», 300 → «300 Б». */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${Math.max(0, Math.round(bytes))} Б`;
  if (bytes < MB) return `${Math.round(bytes / KB)} КБ`;
  const mb = bytes / MB;
  const rounded = Math.round(mb * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : decimalComma(rounded, 1)} МБ`;
}

/** 142 → «142 мс», 1234 → «1,2 с», 5000 → «5 с», 12000 → «12 с». */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} мс`;
  const s = ms / 1000;
  const rounded = s >= 10 ? Math.round(s) : Math.round(s * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : decimalComma(rounded, 1)} с`;
}

/** Скорость: байты за миллисекунды → «84 КБ/с» или «1,2 МБ/с». null, если нечего делить. */
export function formatSpeed(bytes: number, ms: number): string | null {
  const perSecond = speedBytesPerSecond(bytes, ms);
  if (perSecond === null) return null;
  if (perSecond >= MB) return `${decimalComma(perSecond / MB, 1)} МБ/с`;
  return `${Math.max(1, Math.round(perSecond / KB))} КБ/с`;
}

export function speedBytesPerSecond(bytes: number, ms: number): number | null {
  if (!(ms > 0) || !(bytes > 0)) return null;
  return (bytes / ms) * 1000;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * «2026-10-01 14:35:12 (UTC+03:00, Europe/Moscow)».
 * tzOffsetMinutes — как у Date.getTimezoneOffset(): минуты «до UTC», у Москвы −180.
 * Время считаем сами, а не через Intl, чтобы результат не зависел от часового пояса
 * машины, где идёт тест.
 */
export function formatMoment(date: Date, tzOffsetMinutes: number, timeZone: string): string {
  const shifted = new Date(date.getTime() - tzOffsetMinutes * 60_000);
  const day = `${shifted.getUTCFullYear()}-${two(shifted.getUTCMonth() + 1)}-${two(shifted.getUTCDate())}`;
  const time = `${two(shifted.getUTCHours())}:${two(shifted.getUTCMinutes())}:${two(shifted.getUTCSeconds())}`;
  const sign = tzOffsetMinutes <= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMinutes);
  const offset = `UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
  return `${day} ${time} (${timeZone ? `${offset}, ${timeZone}` : offset})`;
}
