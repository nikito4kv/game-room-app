// Цвет бейджа клуба (А6): фон — цвет из ключа, текст — чёрный или белый, смотря
// что контрастнее (WCAG 2.x, относительная яркость). Цвета нет — нейтральный
// бейдж дизайн-системы.

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость #RRGGBB (0 — чёрный, 1 — белый); кривой цвет — null. */
export function relativeLuminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух яркостей (1…21). */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const INK_DARK = "#111111";
const INK_LIGHT = "#ffffff";

/** Цвет текста на фоне бейджа: из двух — тот, у кого контраст выше. */
export function badgeTextColor(bg: string): string | null {
  const l = relativeLuminance(bg);
  if (l === null) return null;
  const dark = contrastRatio(l, relativeLuminance(INK_DARK) ?? 0);
  const light = contrastRatio(l, 1);
  return dark >= light ? INK_DARK : INK_LIGHT;
}
