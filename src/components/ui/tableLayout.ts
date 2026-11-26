// Геометрия стола — чистые функции (тест рядом). Столов два:
//  • круглый (seatAngles / labelAbove / seatPoint) — кружки по окружности:
//    комната при выключенном флаге rumik_table и превью ссылок (ogCard);
//  • под углом (arena*) — Румики одного размера стоят по эллипсу вокруг стола,
//    никто не залезает на стол: комната и мини-стол TablePreview.

import { AXIS_X, BODY, HAND_R, LEG, POSES, STROKE, VIEW, handAt, type RumikPose } from "@/lib/rumik/geometry";

/**
 * Углы мест за круглым столом, в градусах (0° — справа, по часовой).
 * Рассадка повёрнута на полшага: при 3–6 людях никто не сидит строго
 * сверху. Один — сверху, двое — слева и справа.
 */
export function seatAngles(n: number): number[] {
  if (n <= 1) return [-90];
  const start = n === 2 ? 180 : -90 + 180 / n;
  return Array.from({ length: n }, (_, i) => start + (360 / n) * i);
}

/** Подпись места — над аватаром, если место в верхней половине стола. */
export function labelAbove(angleDeg: number): boolean {
  return Math.sin((angleDeg * Math.PI) / 180) < -0.2;
}

/**
 * Центр места в процентах от стороны квадрата стола. radius — радиус
 * окружности мест в процентах (40 — места на 80% диаметра).
 */
export function seatPoint(angleDeg: number, radius = 40): { left: number; top: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { left: 50 + radius * Math.cos(a), top: 50 + radius * Math.sin(a) };
}

/* ------------------------------------------------------ Стол под углом */

// Все размеры арены — в процентах её ширины (и по x, и по y): так эллипсы не
// искажаются. В CSS y переводится в проценты высоты (arenaTop).

/** Арена стола под углом: ширина к высоте, как в макете (16:11). */
export const ARENA_ASPECT = 16 / 11;
/** Высота арены в процентах её ширины. */
export const ARENA_HEIGHT = 100 / ARENA_ASPECT;

/** Стол — эллипс: центр и полуоси. Достаточно большой, чтобы в центр влезла кнопка. */
export const ARENA_TABLE = { cx: 50, cy: 35, rx: 24, ry: 11 } as const;
/** Эллипс, на котором стоят ноги Румиков. */
export const ARENA_RING = { cx: 50, cy: 41.5, rx: 40, ry: 19.5 } as const;

/** Рамка Румика (VIEW): высота к ширине. */
export const SEAT_FRAME_RATIO = VIEW.h / VIEW.w;

// Полуширина стоящего Румика: от оси до края опущенной кисти с обводкой.
const HALF_SPAN = AXIS_X - (handAt(POSES.stand.l)[0] - HAND_R - STROKE / 2);

/**
 * Где в рамке стоит сама фигура (доли ширины и высоты рамки): ось, края кистей,
 * макушка и подошвы. Рамка шире фигуры (там место для шапок и значков), а ось
 * сдвинута левее середины — место ставим по оси и подошвам, а не по рамке.
 */
export const SEAT_FIGURE = {
  axis: (AXIS_X - VIEW.x) / VIEW.w,
  left: (AXIS_X - HALF_SPAN - VIEW.x) / VIEW.w,
  right: (AXIS_X + HALF_SPAN - VIEW.x) / VIEW.w,
  head: (BODY.y - STROKE / 2 - VIEW.y) / VIEW.h,
  feet: (LEG.y + LEG.h + STROKE / 2 - VIEW.y) / VIEW.h,
} as const;

/** Голова (тело без ног) в долях рамки: у неё всплывает пузырь реакции. */
export const SEAT_HEAD = {
  left: (BODY.x - VIEW.x) / VIEW.w,
  top: (BODY.y - VIEW.y) / VIEW.h,
  width: BODY.w / VIEW.w,
  height: BODY.h / VIEW.h,
} as const;

/**
 * Значок «говорит» у головы справа и значок мьюта у руки — угол в долях рамки.
 * speakingLow — место значка «говорит», пока правая кисть поднята (жесты 👍, 🔥,
 * GG): у правого бока ниже плеча, где в этих позах нет ни кисти, ни руки.
 */
export const SEAT_BADGES = {
  speaking: { left: 0.73, top: 0.03 },
  speakingLow: { left: 0.73, top: 0.55 },
  muted: { left: 0.66, top: 0.6 },
} as const;

/**
 * Где значок «говорит» у Румика в позе pose. Обычно — у головы справа; если
 * правая кисть поднята выше середины тела, значок у головы закрыл бы её — тогда
 * он у правого бока (speakingLow). Тест проверяет все позы.
 */
export function speakingBadgeSpot(pose: RumikPose = "stand"): { left: number; top: number } {
  return handAt(POSES[pose].r)[1] < BODY.y + BODY.h / 2 ? SEAT_BADGES.speakingLow : SEAT_BADGES.speaking;
}

/**
 * Подпись места, px: зазор от подошв (или от значка «говорит» над головой) и
 * насколько ниже стоит подпись говорящего — лаймовая обводка и свечение `glow`
 * не должны закрывать ник (макет: `.seat.speaking .nm.below`). Сдвиг — только на
 * арене от shiftFromPx: там Румики крупные и обводка толщиной 3–5 px легла бы на
 * ник. На арене уже фигуры мелкие, обводка ≈ 2 px и зазора хватает, а места
 * стоят тесно: опущенная подпись задела бы соседа. Тест рассадки считает подпись
 * под ногами в обоих положениях.
 */
export const SEAT_LABEL = { gapPx: 3, speakingShiftPx: 6, shiftFromPx: 700 } as const;

/** Подпись места не шире места × LABEL_K: иначе соседние подписи сходятся. */
const LABEL_K = 1.1;
/** Подпись над фигурой — у дальних мест (верх стола): снизу им мешал бы стол. */
const FAR_SIN = -0.45;
/**
 * Растяжка по вертикали при раздаче мест по эллипсу. Места делят эллипс на
 * равные дуги, но вертикальный шаг весит больше: по бокам Румики стоят друг над
 * другом, и между ними ещё подпись.
 */
const STRETCH_Y = 1.15;

/**
 * Ширина места (в процентах ширины арены) по числу людей. До шести — как в
 * макете; дальше меньше, чтобы соседи не наезжали. Подобрано и проверено
 * тестом: при 1…10 людях ни фигура, ни подпись не задевают стол и соседей
 * даже на самой узкой арене (500 px).
 */
const SEAT_WIDTH = [19, 19, 19, 19, 19, 19, 18, 14.5, 14.5, 14.5] as const;

/** Ширина места в процентах ширины арены — одна на всех за этим столом. */
export function arenaSeatWidth(n: number): number {
  if (n <= SEAT_WIDTH.length) return SEAT_WIDTH[Math.max(1, n) - 1];
  // Больше десяти в комнату не пускают; на всякий случай — помельче.
  return Math.max(9, 150 / n);
}

const angleCache = new Map<number, number[]>();

/**
 * Углы мест на эллипсе, в градусах: место 0 — внизу (90°, ближе всего к
 * зрителю), дальше по часовой на экране — влево, вверх, вправо. Места делят
 * эллипс на равные по длине дуги (с растяжкой STRETCH_Y), а не на равные углы:
 * на сплюснутом эллипсе равные углы сбивают места по бокам в кучу.
 */
export function arenaAngles(n: number): number[] {
  if (n <= 0) return [];
  const hit = angleCache.get(n);
  if (hit) return hit;
  const steps = 720;
  const len = [0];
  const at = (i: number) => Math.PI / 2 + (i * 2 * Math.PI) / steps;
  for (let i = 1; i <= steps; i++) {
    const a = at(i - 1);
    const b = at(i);
    const dx = ARENA_RING.rx * (Math.cos(b) - Math.cos(a));
    const dy = ARENA_RING.ry * STRETCH_Y * (Math.sin(b) - Math.sin(a));
    len.push(len[i - 1] + Math.hypot(dx, dy));
  }
  const total = len[steps];
  const out: number[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * total) / n;
    while (len[i + 1] < target) i++;
    // Между соседними шагами — линейно: углы плавные, без ступенек.
    const t = len[i + 1] === len[i] ? 0 : (target - len[i]) / (len[i + 1] - len[i]);
    const rad = at(i) + t * (at(i + 1) - at(i));
    out.push(Math.round(((rad * 180) / Math.PI) * 100) / 100);
  }
  angleCache.set(n, out);
  return out;
}

export type ArenaSeat = {
  /** Точка подошв: x и y в процентах ширины арены. */
  x: number;
  y: number;
  /** Для CSS: left — % ширины, top — % высоты арены. */
  left: number;
  top: number;
  /** Угол на эллипсе, градусы (90 — внизу). */
  angle: number;
  /** Подпись над фигурой (дальние места), иначе — под ногами. */
  labelAbove: boolean;
  /** Порядок слоёв: кто ближе к зрителю (ниже), тот поверх. */
  z: number;
  /** Куда смотрят глаза: к центру стола (для <Rumik look>). */
  look: [number, number];
};

export type Arena = {
  /** Ширина места (рамки Румика) — % ширины арены, одна на всех. */
  seatWidth: number;
  /** Наибольшая ширина подписи — % ширины арены. */
  labelWidth: number;
  /** Места в порядке людей. */
  seats: ArenaSeat[];
};

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Рассадка за столом под углом. Места — в порядке людей (порядок входа);
 * self — индекс «себя»: он стоит внизу, ближе всех к зрителю, остальные идут от
 * него по часовой. Без себя (мини-стол в лобби) self = 0: внизу первый.
 */
export function arenaLayout(n: number, self = 0): Arena {
  const seatWidth = arenaSeatWidth(n);
  const angles = arenaAngles(n);
  const me = n > 0 ? ((Math.round(self) % n) + n) % n : 0;
  const seats = Array.from({ length: n }, (_, i): ArenaSeat => {
    const angle = angles[(i - me + n) % n];
    const a = (angle * Math.PI) / 180;
    const x = ARENA_RING.cx + ARENA_RING.rx * Math.cos(a);
    const y = ARENA_RING.cy + ARENA_RING.ry * Math.sin(a);
    return {
      x,
      y,
      left: x,
      top: (y / ARENA_HEIGHT) * 100,
      angle,
      labelAbove: Math.sin(a) < FAR_SIN,
      z: Math.round(y),
      look: [round1(-3 * Math.cos(a)) || 0, round1(-2 * Math.sin(a)) || 0],
    };
  });
  return { seatWidth, labelWidth: seatWidth * LABEL_K, seats };
}

/** Прямоугольник в процентах арены: left/width — ширины, top/height — высоты. */
export type ArenaBox = { left: number; top: number; width: number; height: number };

/**
 * Стол пустой арены (людей нет — мини-стол в лобби пустой комнаты): места не
 * нужны, стол крупнее, чтобы в центр влезли код и кнопка «Пригласить».
 */
export const EMPTY_TABLE_SCALE = 1.45;

/** Стол на арене — для CSS. scale — во сколько раз крупнее обычного (вокруг центра). */
export function arenaTableBox(scale = 1): ArenaBox {
  const t = ARENA_TABLE;
  const rx = t.rx * scale;
  const ry = t.ry * scale;
  return {
    left: t.cx - rx,
    top: ((t.cy - ry) / ARENA_HEIGHT) * 100,
    width: rx * 2,
    height: ((ry * 2) / ARENA_HEIGHT) * 100,
  };
}

/**
 * Центр стола — прямоугольник, целиком вписанный в эллипс (углы на краю): всё,
 * что в нём лежит (код, «Пока тут только вы», кнопки), не вылезает за стол.
 */
export function arenaCenterBox(scale = 1): ArenaBox {
  const t = ARENA_TABLE;
  const hw = t.rx * scale * 0.8;
  const hh = t.ry * scale * 0.6;
  return {
    left: t.cx - hw,
    top: ((t.cy - hh) / ARENA_HEIGHT) * 100,
    width: hw * 2,
    height: ((hh * 2) / ARENA_HEIGHT) * 100,
  };
}
