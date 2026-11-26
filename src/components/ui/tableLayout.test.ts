import { describe, expect, it } from "vitest";
import { HAND_R, POSES, RUMIK_POSES, STROKE, VIEW, handAt } from "@/lib/rumik/geometry";
import {
  ARENA_HEIGHT,
  ARENA_RING,
  ARENA_TABLE,
  EMPTY_TABLE_SCALE,
  SEAT_BADGES,
  SEAT_FIGURE,
  SEAT_FRAME_RATIO,
  SEAT_LABEL,
  arenaAngles,
  arenaCenterBox,
  arenaLayout,
  arenaTableBox,
  labelAbove,
  seatAngles,
  seatPoint,
  speakingBadgeSpot,
} from "./tableLayout";

describe("seatAngles", () => {
  it("один — сверху, двое — слева и справа", () => {
    expect(seatAngles(1)).toEqual([-90]);
    expect(seatAngles(0)).toEqual([-90]);
    expect(seatAngles(2)).toEqual([180, 360]);
  });

  it("никто не сидит строго сверху при 3–6 людях", () => {
    for (let n = 3; n <= 6; n++) {
      const top = seatAngles(n).some((a) => Math.abs((((a % 360) + 360) % 360) - 270) < 1);
      expect(top).toBe(false);
    }
  });

  it("места равномерно по кругу", () => {
    const a = seatAngles(5);
    expect(a).toHaveLength(5);
    expect(a[1] - a[0]).toBeCloseTo(72);
  });
});

describe("labelAbove", () => {
  it("верхняя половина — подпись над аватаром", () => {
    expect(labelAbove(-54)).toBe(true);
    expect(labelAbove(-90)).toBe(true);
  });

  it("бока и низ — под аватаром", () => {
    expect(labelAbove(0)).toBe(false);
    expect(labelAbove(18)).toBe(false);
    expect(labelAbove(90)).toBe(false);
  });
});

describe("seatPoint", () => {
  it("справа, снизу и сверху от центра", () => {
    expect(seatPoint(0)).toEqual({ left: 90, top: 50 });
    const bottom = seatPoint(90);
    expect(bottom.left).toBeCloseTo(50);
    expect(bottom.top).toBeCloseTo(90);
    expect(seatPoint(-90, 30).top).toBeCloseTo(20);
  });
});

/* ------------------------------------------------------ Стол под углом */

type Box = { x0: number; x1: number; y0: number; y1: number };

/** Подпись: одна строка (ник, корона, значки, связь) — 20 px. */
const LINE_PX = 20;
const GAP_PX = SEAT_LABEL.gapPx;
/** Подпись говорящего под ногами — ниже на столько (на широкой арене); говорить может любой. */
const shiftPx = (widthPx: number) => (widthPx >= SEAT_LABEL.shiftFromPx ? SEAT_LABEL.speakingShiftPx : 0);
/** Значок «говорит» у головы — до 26 px. */
const BADGE_PX = 26;

/**
 * Что занимает место на арене шириной widthPx: фигура со значками и подпись.
 * Всё в процентах ширины арены. px переводятся в проценты по ширине арены —
 * на узкой арене подпись и значки занимают больше. Подпись под ногами — от
 * обычного положения до сдвинутого у говорящего: оба должны быть свободны.
 */
function seatBoxes(n: number, self: number, widthPx: number) {
  const { seatWidth: w, labelWidth, seats } = arenaLayout(n, self);
  const h = w * SEAT_FRAME_RATIO;
  const px = 100 / widthPx;
  return seats.map((s) => {
    const frameLeft = s.x - SEAT_FIGURE.axis * w;
    // Значок «говорит» — у головы или у правого бока (жест): берём дальний край.
    const badgeLeft = Math.max(SEAT_BADGES.speaking.left, SEAT_BADGES.speakingLow.left);
    const figure: Box = {
      x0: frameLeft + SEAT_FIGURE.left * w,
      x1: Math.max(frameLeft + SEAT_FIGURE.right * w, frameLeft + badgeLeft * w + BADGE_PX * px),
      y0: s.y - (SEAT_FIGURE.feet - SEAT_BADGES.speaking.top) * h,
      y1: s.y,
    };
    const half = labelWidth / 2;
    const label: Box = s.labelAbove
      ? { x0: s.x - half, x1: s.x + half, y0: figure.y0 - (GAP_PX + LINE_PX) * px, y1: figure.y0 - GAP_PX * px }
      : { x0: s.x - half, x1: s.x + half, y0: s.y + GAP_PX * px, y1: s.y + (GAP_PX + shiftPx(widthPx) + LINE_PX) * px };
    return { seat: s, figure, label };
  });
}

const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Прямоугольник задевает эллипс стола: ближайшая к центру точка — внутри. */
function hitsTable(r: Box): boolean {
  const t = ARENA_TABLE;
  const nx = Math.min(Math.max(0, (r.x0 - t.cx) / t.rx), (r.x1 - t.cx) / t.rx);
  const ny = Math.min(Math.max(0, (r.y0 - t.cy) / t.ry), (r.y1 - t.cy) / t.ry);
  return nx * nx + ny * ny < 1;
}

describe("arenaLayout — стол под углом", () => {
  it("места стоят на эллипсе", () => {
    for (let n = 1; n <= 10; n++) {
      for (const s of arenaLayout(n).seats) {
        const e = ((s.x - ARENA_RING.cx) / ARENA_RING.rx) ** 2 + ((s.y - ARENA_RING.cy) / ARENA_RING.ry) ** 2;
        expect(e).toBeCloseTo(1, 6);
      }
    }
  });

  it("все места одного размера, с ростом людей — не крупнее", () => {
    let prev = Infinity;
    for (let n = 1; n <= 10; n++) {
      const { seatWidth, labelWidth } = arenaLayout(n);
      expect(seatWidth).toBeGreaterThanOrEqual(14.5);
      expect(seatWidth).toBeLessThanOrEqual(prev);
      expect(labelWidth).toBeGreaterThan(seatWidth);
      prev = seatWidth;
    }
    expect(arenaLayout(4).seatWidth).toBe(19);
  });

  it("при 1…10 людях никто не залезает на стол и на соседей", () => {
    for (const widthPx of [500, SEAT_LABEL.shiftFromPx - 1, SEAT_LABEL.shiftFromPx, 1100]) {
      for (let n = 1; n <= 10; n++) {
        for (const self of [0, n - 1]) {
          const boxes = seatBoxes(n, self, widthPx);
          for (const b of boxes) {
            expect(hitsTable(b.figure), `n=${n} w=${widthPx}: фигура на столе`).toBe(false);
            expect(hitsTable(b.label), `n=${n} w=${widthPx}: подпись на столе`).toBe(false);
            // Не выходит за арену (у подписей запас 3% — поля зоны вокруг стола).
            expect(b.figure.x0).toBeGreaterThanOrEqual(0);
            expect(b.figure.x1).toBeLessThanOrEqual(100);
            expect(b.figure.y0).toBeGreaterThanOrEqual(0);
            expect(b.label.y0).toBeGreaterThanOrEqual(-3);
            expect(b.label.y1).toBeLessThanOrEqual(ARENA_HEIGHT + 3);
          }
          for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
              const [a, b] = [boxes[i], boxes[j]];
              const hit =
                overlap(a.figure, b.figure) ||
                overlap(a.figure, b.label) ||
                overlap(a.label, b.figure) ||
                overlap(a.label, b.label);
              expect(hit, `n=${n} w=${widthPx}: места ${i} и ${j} наезжают`).toBe(false);
            }
          }
        }
      }
    }
  });

  it("свой — внизу посередине, ближе всех к зрителю", () => {
    for (let n = 1; n <= 10; n++) {
      for (let self = 0; self < n; self++) {
        const { seats } = arenaLayout(n, self);
        const me = seats[self];
        expect(me.x).toBeCloseTo(50, 6);
        expect(me.angle).toBe(90);
        for (const s of seats) {
          if (s !== me) expect(s.y).toBeLessThan(me.y);
          expect(s.z).toBeLessThanOrEqual(me.z);
        }
      }
    }
  });

  it("остальные — от себя по часовой: влево, вверх, вправо", () => {
    const { seats } = arenaLayout(4, 1);
    expect(seats[2].x).toBeLessThan(50); // следующий за мной — слева
    expect(seats[3].y).toBeLessThan(seats[2].y); // напротив — вверху
    expect(seats[0].x).toBeGreaterThan(50); // перед мной вошёл — справа
  });

  it("обводка glow под ногами не ложится на подпись говорящего, и подпись не отрывается от фигуры", () => {
    // Лаймовая обводка glow выходит за силуэт на 6 единиц рамки (strokeWidth 12).
    const GLOW_OUT = 6;
    for (const widthPx of [500, SEAT_LABEL.shiftFromPx - 1, SEAT_LABEL.shiftFromPx, 1100]) {
      for (let n = 1; n <= 10; n++) {
        const seatPx = (arenaLayout(n).seatWidth / 100) * widthPx;
        const outline = (GLOW_OUT * seatPx) / VIEW.w;
        const gap = SEAT_LABEL.gapPx + shiftPx(widthPx);
        expect(gap, `n=${n} w=${widthPx}: обводка ${outline.toFixed(1)} px`).toBeGreaterThan(outline);
        expect(gap - outline, `n=${n} w=${widthPx}: подпись далеко от ног`).toBeLessThan(8);
      }
    }
  });

  it("значок «говорит» не закрывает кисти ни в одной позе", () => {
    // Сторона значка в единицах рамки — от 20 px на узкой арене до 26 px на широкой.
    const sides = new Set<number>();
    for (const widthPx of [500, SEAT_LABEL.shiftFromPx - 1, SEAT_LABEL.shiftFromPx, 1100]) {
      for (let n = 1; n <= 10; n++) {
        const seatPx = (arenaLayout(n).seatWidth / 100) * widthPx;
        sides.add(((widthPx >= 700 ? BADGE_PX : 20) * VIEW.w) / seatPx);
      }
    }
    const r = HAND_R + STROKE / 2;
    for (const pose of RUMIK_POSES) {
      const spot = speakingBadgeSpot(pose);
      const x0 = VIEW.x + spot.left * VIEW.w;
      const y0 = VIEW.y + spot.top * VIEW.h;
      for (const side of sides) {
        for (const hand of [POSES[pose].l, POSES[pose].r]) {
          const [cx, cy] = handAt(hand);
          // Ближайшая к центру кисти точка квадрата значка — снаружи круга кисти.
          const nx = Math.min(Math.max(cx, x0), x0 + side);
          const ny = Math.min(Math.max(cy, y0), y0 + side);
          expect(Math.hypot(cx - nx, cy - ny), `${pose}: значок ${side.toFixed(0)} ед. на кисти`).toBeGreaterThan(r);
        }
      }
    }
  });

  it("подпись над фигурой у дальних мест, под ногами — у остальных", () => {
    const two = arenaLayout(2).seats;
    expect(two[0].labelAbove).toBe(false);
    expect(two[1].labelAbove).toBe(true);
    for (let n = 1; n <= 10; n++) {
      for (const s of arenaLayout(n).seats) {
        expect(s.labelAbove).toBe(Math.sin((s.angle * Math.PI) / 180) < -0.45);
      }
    }
  });

  it("места симметричны: слева и справа поровну", () => {
    for (let n = 2; n <= 10; n++) {
      const xs = arenaAngles(n).map((a) => Math.cos((a * Math.PI) / 180));
      expect(xs.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 2);
    }
  });

  it("взгляд — к центру стола", () => {
    const { seats } = arenaLayout(4, 0);
    expect(seats[0].look[1]).toBeLessThan(0); // снизу смотрит вверх
    expect(seats[1].look[0]).toBeGreaterThan(0); // слева — вправо
  });

  it("центр стола целиком внутри эллипса", () => {
    const c = arenaCenterBox();
    const t = ARENA_TABLE;
    const corner = (x: number, yPct: number) =>
      ((x - t.cx) / t.rx) ** 2 + (((yPct / 100) * ARENA_HEIGHT - t.cy) / t.ry) ** 2;
    expect(corner(c.left, c.top)).toBeLessThanOrEqual(1 + 1e-9);
    expect(corner(c.left + c.width, c.top + c.height)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("пустой стол крупнее, но целиком на арене, и центр в нём тоже вписан", () => {
    const s = EMPTY_TABLE_SCALE;
    const table = arenaTableBox(s);
    expect(table.width).toBeGreaterThan(arenaTableBox().width);
    expect(table.left).toBeGreaterThanOrEqual(0);
    expect(table.top).toBeGreaterThanOrEqual(0);
    expect(table.top + table.height).toBeLessThanOrEqual(100);
    const c = arenaCenterBox(s);
    const t = ARENA_TABLE;
    const e = ((c.left - t.cx) / (t.rx * s)) ** 2 + (((c.top / 100) * ARENA_HEIGHT - t.cy) / (t.ry * s)) ** 2;
    expect(e).toBeLessThanOrEqual(1 + 1e-9);
  });
});
