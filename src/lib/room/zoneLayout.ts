// Раскладка зоны комнаты (область под шапкой и левее чата) по её размеру —
// чистые функции. Геометрия самого стола (углы мест, подписи) живёт в
// примитивах: @/components/ui/tableLayout.

export type ZoneLayout = "table" | "row" | "list";

/** Порог ширины: уже — компактный список (узкое окно сбоку от игры). */
export const LIST_BELOW_WIDTH = 560;
/** Порог высоты: ниже — места в ряд (круг не помещается по высоте). */
export const ROW_BELOW_HEIGHT = 540;

/**
 * Какая раскладка участников влезает в зону комнаты (CSS-пиксели). Рендерить
 * ровно одну — иначе задвоятся data-testid="participant".
 */
export function zoneLayout(width: number, height: number): ZoneLayout {
  if (width < LIST_BELOW_WIDTH) return "list";
  if (height < ROW_BELOW_HEIGHT) return "row";
  return "table";
}

/**
 * Размер мест за столом. До шести человек — крупные аватары; больше — средние,
 * иначе места на окружности наезжают друг на друга (в комнате до 10 человек).
 */
export function tableSeatSize(count: number): "md" | "lg" {
  return count > 6 ? "md" : "lg";
}

/** Зазор между тостами и тем, что они не должны закрывать. */
const TOAST_GAP = 8;
/** Тосты под шапкой, когда закрывать нечего: 56 шапка + 12 (как в макете). */
const TOAST_BELOW_HEADER = 12;
/** Верхняя плашка сцены: отступ 12 + «Эфир» и чип стримера высотой 28. */
const STAGE_BAR = 40;
/** Сколько места оставляем над доком под тост, когда ниже списка места нет. */
const TOAST_ROOM_ABOVE_DOCK = 88;

/** Где что стоит на экране комнаты (px от верха окна, getBoundingClientRect). */
export type ToastAnchors = {
  /** Верх зоны комнаты — то есть низ шапки и полосы связи. */
  zoneTop: number;
  /** Низ плашек над зоной (нет микрофона, хост заглушил, чат выключен); null — плашек нет. */
  bannersBottom: number | null;
  /** Верх сцены показа экрана; null — сцены нет. */
  stageTop: number | null;
  /** Раскладка «список»: низ последней строки и низ самой зоны; null — другая раскладка. */
  list: { contentBottom: number; zoneBottom: number } | null;
  /** Верх дока. */
  dockTop: number;
};

/**
 * С какой высоты начинаются тосты — чтобы не закрывать важное (ревью М2, QA №6):
 *  • список (узкое окно): сразу под последней строкой — на стыке с чатом или в
 *    пустоте под списком; длинный список — тогда над доком;
 *  • сцена показа: под её верхней плашкой «Эфир» и выбором показа;
 *  • иначе — сверху слева под шапкой.
 * И никогда не поверх плашек над зоной.
 */
export function toastTop(a: ToastAnchors): number {
  const floor = (a.bannersBottom ?? a.zoneTop) + TOAST_GAP;
  let top: number;
  if (a.list) {
    const belowList = Math.min(a.list.contentBottom, a.list.zoneBottom) + TOAST_GAP;
    top = Math.max(floor, Math.min(belowList, a.dockTop - TOAST_ROOM_ABOVE_DOCK));
  } else if (a.stageTop !== null) {
    top = Math.max(floor, a.stageTop + STAGE_BAR + TOAST_GAP);
  } else {
    top = Math.max(floor, a.zoneTop + TOAST_BELOW_HEADER);
  }
  return Math.round(top);
}

export type PanelSide = "left" | "right" | "bottom";

/**
 * С какой стороны места открыть панель участника: наружу от центра зоны,
 * чтобы панель не закрывала стол. Места у вертикальной оси — панель снизу.
 */
export function panelSide(seatCenterX: number, zoneCenterX: number): PanelSide {
  if (seatCenterX > zoneCenterX + 40) return "right";
  if (seatCenterX < zoneCenterX - 40) return "left";
  return "bottom";
}
