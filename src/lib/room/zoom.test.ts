import { describe, expect, it } from "vitest";
import {
  NO_ZOOM,
  ZOOM_MAX,
  clampZoom,
  formatZoom,
  panBy,
  wheelZoomFactor,
  zoomAt,
  zoomStep,
  type Zoom,
} from "./zoom";

const box = { width: 1600, height: 900 };
/** Точка контента под экранной точкой p при зуме z. */
const contentAt = (z: Zoom, p: { x: number; y: number }) => ({
  x: (p.x - z.x) / z.scale,
  y: (p.y - z.y) / z.scale,
});

describe("zoomAt", () => {
  it("точка под курсором остаётся на месте", () => {
    const p = { x: 1200, y: 300 };
    const z1 = zoomAt(NO_ZOOM, p, 2, box);
    expect(z1.scale).toBe(2);
    expect(contentAt(z1, p).x).toBeCloseTo(contentAt(NO_ZOOM, p).x);
    expect(contentAt(z1, p).y).toBeCloseTo(contentAt(NO_ZOOM, p).y);
    const z2 = zoomAt(z1, p, 1.5, box);
    expect(contentAt(z2, p).x).toBeCloseTo(contentAt(z1, p).x);
    expect(contentAt(z2, p).y).toBeCloseTo(contentAt(z1, p).y);
  });

  it("масштаб не выходит за 1…5", () => {
    let z = NO_ZOOM;
    for (let i = 0; i < 40; i++) z = zoomAt(z, { x: 10, y: 10 }, 1.3, box);
    expect(z.scale).toBe(ZOOM_MAX);
    expect(zoomAt(NO_ZOOM, { x: 10, y: 10 }, 0.5, box)).toBe(NO_ZOOM);
  });

  it("обратный зум до 1 сбрасывает всё, включая сдвиг", () => {
    const z = zoomAt(NO_ZOOM, { x: 1500, y: 800 }, 3, box);
    expect(z.x).toBeLessThan(0);
    expect(zoomAt(z, { x: 100, y: 100 }, 1 / 3, box)).toBe(NO_ZOOM);
  });

  it("у края картинка не отрывается от рамки", () => {
    // Зум у самого левого верхнего угла: сдвиг ноль, а не положительный.
    const z = zoomAt(NO_ZOOM, { x: 0, y: 0 }, 2, box);
    expect(z).toEqual({ scale: 2, x: 0, y: 0 });
  });
});

describe("panBy", () => {
  it("без зума двигать нечего", () => {
    expect(panBy(NO_ZOOM, 100, 100, box)).toBe(NO_ZOOM);
  });

  it("сдвиг упирается в края", () => {
    const z = zoomAt(NO_ZOOM, { x: 800, y: 450 }, 2, box);
    const far = panBy(z, -10_000, -10_000, box);
    expect(far.x).toBe(box.width - box.width * 2);
    expect(far.y).toBe(box.height - box.height * 2);
    const back = panBy(far, 10_000, 10_000, box);
    expect(back.x).toBe(0);
    expect(back.y).toBe(0);
  });
});

describe("clampZoom", () => {
  it("после уменьшения рамки сдвиг поджимается", () => {
    const z = { scale: 2, x: -1600, y: -900 };
    const small = { width: 800, height: 450 };
    expect(clampZoom(z, small)).toEqual({ scale: 2, x: -800, y: -450 });
  });
});

describe("zoomStep", () => {
  it("кнопка «+» увеличивает вокруг центра, «−» возвращает", () => {
    const z = zoomStep(NO_ZOOM, 1, box);
    expect(z.scale).toBeCloseTo(1.25);
    const center = { x: 800, y: 450 };
    expect(contentAt(z, center).x).toBeCloseTo(800);
    expect(zoomStep(z, -1, box)).toBe(NO_ZOOM);
  });
});

describe("wheelZoomFactor", () => {
  it("щелчок колеса — ×1,15 к себе и обратно", () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(1.15);
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(1 / 1.15);
  });

  it("строки Firefox пересчитываются в пиксели", () => {
    const lines = wheelZoomFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false });
    const px = wheelZoomFactor({ deltaY: -48, deltaMode: 0, ctrlKey: false });
    expect(lines).toBeCloseTo(px);
  });

  it("щипок тачпада чувствительнее, но один шаг не прыгает больше чем вдвое", () => {
    const pinch = wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true });
    expect(pinch).toBeGreaterThan(wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: false }));
    expect(wheelZoomFactor({ deltaY: -5000, deltaMode: 0, ctrlKey: true })).toBe(2);
    expect(wheelZoomFactor({ deltaY: 5000, deltaMode: 0, ctrlKey: true })).toBe(0.5);
  });
});

describe("formatZoom", () => {
  it("десятичная запятая", () => {
    expect(formatZoom(2)).toBe("×2,0");
    expect(formatZoom(1.5625)).toBe("×1,6");
  });
});
