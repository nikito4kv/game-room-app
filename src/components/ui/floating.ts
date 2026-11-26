// Позиционирование всплывающих элементов (меню, поповер, тултип) возле якоря.
// Чистая функция: на входе прямоугольники, на выходе координаты. Сама
// переворачивается на противоположную сторону, если не влезает, и прижимается
// к краям окна. Библиотеки вроде floating-ui ради этого не тащим.

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export type FloatingInput = {
  anchor: Rect;
  floating: Size;
  viewport: Size;
  side: Side;
  align?: Align;
  /** Зазор между якорем и элементом, px. */
  offset?: number;
  /** Минимальный отступ от краёв окна, px. */
  padding?: number;
};

export type FloatingResult = { x: number; y: number; side: Side };

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function clamp(v: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(v, min), max);
}

/** Свободное место от якоря до края окна с данной стороны. */
function room(side: Side, a: Rect, vp: Size): number {
  switch (side) {
    case "top":
      return a.y;
    case "bottom":
      return vp.height - (a.y + a.height);
    case "left":
      return a.x;
    case "right":
      return vp.width - (a.x + a.width);
  }
}

function place(side: Side, align: Align, a: Rect, f: Size, offset: number): { x: number; y: number } {
  const vertical = side === "top" || side === "bottom";
  let x: number;
  let y: number;
  if (vertical) {
    y = side === "top" ? a.y - f.height - offset : a.y + a.height + offset;
    x = align === "start" ? a.x : align === "end" ? a.x + a.width - f.width : a.x + (a.width - f.width) / 2;
  } else {
    x = side === "left" ? a.x - f.width - offset : a.x + a.width + offset;
    y = align === "start" ? a.y : align === "end" ? a.y + a.height - f.height : a.y + (a.height - f.height) / 2;
  }
  return { x, y };
}

export function computeFloatingPosition({
  anchor,
  floating,
  viewport,
  side,
  align = "center",
  offset = 8,
  padding = 8,
}: FloatingInput): FloatingResult {
  const vertical = side === "top" || side === "bottom";
  const need = (vertical ? floating.height : floating.width) + offset + padding;

  // Переворот: если с нужной стороны не влезает, а с противоположной места больше.
  let finalSide = side;
  if (room(side, anchor, viewport) < need && room(OPPOSITE[side], anchor, viewport) > room(side, anchor, viewport)) {
    finalSide = OPPOSITE[side];
  }

  const p = place(finalSide, align, anchor, floating, offset);
  return {
    x: Math.round(clamp(p.x, padding, viewport.width - floating.width - padding)),
    y: Math.round(clamp(p.y, padding, viewport.height - floating.height - padding)),
    side: finalSide,
  };
}

/** Точка (например, курсор при клике по плитке) как якорь нулевого размера. */
export function pointRect(x: number, y: number): Rect {
  return { x, y, width: 0, height: 0 };
}
