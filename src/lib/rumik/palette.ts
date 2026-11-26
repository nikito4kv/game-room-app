// Быстрая палитра и кисть рисовалки Румика (R2).
//
// Это цвета ДАННЫХ, а не интерфейса: краска запекается в PNG рисунка и должна
// выглядеть одинаково в любой теме и у любого зрителя, поэтому здесь hex, а не
// токены --gr-*. Значения сняты с тёмной темы: первые пять — белый Румик, тёмная
// плашка лица и три «природных», дальше палитра аватаров 0–9 (--gr-avatar-*).
// Отдельный модуль без зависимостей: его берёт и лёгкая заглушка на главной.

export type PaintSwatch = { readonly hex: string; readonly name: string };

export const PAINT_PALETTE: readonly PaintSwatch[] = [
  { hex: "#f1f2f4", name: "Белый" },
  { hex: "#14161b", name: "Чёрный" },
  { hex: "#8b5e3c", name: "Коричневый" },
  { hex: "#4f7a3d", name: "Зелёный" },
  { hex: "#e5484d", name: "Красный" },
  { hex: "#ffa098", name: "Коралл" },
  { hex: "#f9a870", name: "Абрикос" },
  { hex: "#e1b75c", name: "Песок" },
  { hex: "#71d6a3", name: "Мята" },
  { hex: "#47d6cf", name: "Бирюза" },
  { hex: "#52cff3", name: "Лазурь" },
  { hex: "#89c3fe", name: "Небо" },
  { hex: "#b0b7ff", name: "Барвинок" },
  { hex: "#d5a8f8", name: "Сирень" },
  { hex: "#f19fd6", name: "Фуксия" },
];

/** Некрашеный Румик (как --gr-rumik-white): его видно там, где краски нет. */
export const PAINT_BASE = "#f1f2f4";
/** Цвет кисти при первом открытии. */
export const DEFAULT_PAINT_COLOR = "#89c3fe";

/** Размер кисти в мировых единицах (ширина тела — 132). */
export const BRUSH_MIN = 4;
export const BRUSH_MAX = 64;
export const BRUSH_DEFAULT = 20;

/** На сколько может уйти каждый канал, чтобы цвет считался цветом палитры. */
const SNAP = 2;

/**
 * Цвет пипетки → цвет палитры, если он отличается на ±2 по каналам: холст
 * хранит краску с премультипликацией, и #e5484d возвращается как #e5474d.
 * Иначе в палитре ничего не выделилось бы. `hex` — #rrggbb в нижнем регистре.
 */
export function snapToPalette(hex: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const near = PAINT_PALETTE.find((s) => [0, 1, 2].every((i) => Math.abs(ch(s.hex, i) - ch(hex, i)) <= SNAP));
  return near?.hex ?? hex;
}
