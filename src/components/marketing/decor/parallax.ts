// Параллакс «стены» по краям витрины (DecorWall): чистая арифметика без DOM,
// чтобы её можно было проверить тестом.

/** С какой ширины окна стена видна и двигается (то же число в классе min-[1700px]). */
export const WALL_MIN_WIDTH = 1700;

/** Сдвиг правой стены по вертикали в долях высоты плитки: узоры слева и справа не совпадают. */
export const RIGHT_WALL_SHIFT = 0.45;

/**
 * Вертикальный сдвиг слоя стены в px (всегда в пределах (−tileHeight, 0]).
 * Слой выше окна на одну плитку и уезжает вверх со скоростью `speed` от прокрутки,
 * а по модулю высоты плитки возвращается назад — узор бесшовный, слой не кончается.
 * `offset` — начальная фаза (у правой стены), `scrollY` < 0 (оттяжка на тачпаде) тоже даёт
 * сдвиг в тех же пределах, без щели сверху.
 */
export function wallOffset(scrollY: number, speed: number, tileHeight: number, offset = 0): number {
  if (!(tileHeight > 0)) return 0;
  const raw = (Number.isFinite(scrollY) ? scrollY : 0) * speed + offset;
  const phase = ((raw % tileHeight) + tileHeight) % tileHeight;
  // Округление до десятых: меньше перерисовок от дробей, а глазу разницы нет.
  const px = Math.round(phase * 10) / 10;
  return px === 0 || px === tileHeight ? 0 : -px;
}

/** Начальная фаза слоя: левая стена с нуля, правая сдвинута на RIGHT_WALL_SHIFT плитки. */
export function wallPhase(side: "left" | "right", tileHeight: number): number {
  return side === "left" ? 0 : Math.round(tileHeight * RIGHT_WALL_SHIFT);
}
