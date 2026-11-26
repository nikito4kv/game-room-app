// Зум демонстрации колёсиком, клавишами и перетаскиванием — чистая математика.
//
// Слой с видео рисуется как transform: translate(x, y) scale(s) от левого
// верхнего угла (transform-origin: 0 0). Точка контента u (в координатах
// неувеличенного слоя) оказывается на экране в p = x + s·u. Отсюда два правила:
//  • зум к точке p держит под курсором ту же точку контента:
//    u = (p − x) / s  →  x' = p − (p − x) · s' / s;
//  • слой не уезжает из рамки: x ∈ [w − w·s, 0], y ∈ [h − h·s, 0].

export type Zoom = { scale: number; x: number; y: number };
export type Box = { width: number; height: number };
export type Point = { x: number; y: number };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
/** Без увеличения. Один объект: сравнение `zoom === NO_ZOOM` — «зума нет». */
export const NO_ZOOM: Zoom = Object.freeze({ scale: 1, x: 0, y: 0 });
/** Шаг кнопок и клавиш «+» / «−». */
export const ZOOM_STEP = 1.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Масштаб в пределах 1…5 и сдвиг в пределах рамки. Масштаб, почти равный 1,
 * сбрасывает зум целиком: иначе после «туда-обратно» оставался бы ×1,0000001
 * и плашка «Сбросить» висела бы зря.
 */
export function clampZoom(z: Zoom, box: Box): Zoom {
  const scale = clamp(z.scale, ZOOM_MIN, ZOOM_MAX);
  if (scale < ZOOM_MIN + 0.01) return NO_ZOOM;
  return {
    scale,
    x: clamp(z.x, box.width - box.width * scale, 0),
    y: clamp(z.y, box.height - box.height * scale, 0),
  };
}

/** Увеличить в `factor` раз так, чтобы точка под курсором осталась на месте. */
export function zoomAt(z: Zoom, point: Point, factor: number, box: Box): Zoom {
  const scale = clamp(z.scale * factor, ZOOM_MIN, ZOOM_MAX);
  const k = scale / z.scale;
  return clampZoom(
    { scale, x: point.x - (point.x - z.x) * k, y: point.y - (point.y - z.y) * k },
    box,
  );
}

/** Сдвиг перетаскиванием. Без зума двигать нечего. */
export function panBy(z: Zoom, dx: number, dy: number, box: Box): Zoom {
  if (z.scale <= ZOOM_MIN) return z;
  return clampZoom({ scale: z.scale, x: z.x + dx, y: z.y + dy }, box);
}

/** Шаг кнопкой или клавишей — вокруг центра рамки. */
export function zoomStep(z: Zoom, direction: 1 | -1, box: Box): Zoom {
  const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomAt(z, { x: box.width / 2, y: box.height / 2 }, factor, box);
}

/**
 * Множитель зума за одно событие колеса. Щелчок колеса мыши в Chrome — около
 * 100 px и даёт ×1,15. Щипок тачпада приходит как wheel с ctrlKey и мелкими
 * шагами — для него чувствительность выше. Firefox считает в строках
 * (deltaMode 1), страницы (2) — редкость, но тоже учитываем.
 */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1);
  const perPx = e.ctrlKey ? 0.01 : Math.log(1.15) / 100;
  return clamp(Math.exp(-px * perPx), 0.5, 2);
}

/** Подпись масштаба для плашки: «×2,0». */
export function formatZoom(scale: number): string {
  return `×${scale.toFixed(1).replace(".", ",")}`;
}
