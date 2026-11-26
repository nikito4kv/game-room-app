import { describe, expect, it } from "vitest";
import { computeFloatingPosition, pointRect } from "./floating";

const viewport = { width: 1000, height: 800 };
const floating = { width: 200, height: 100 };

describe("computeFloatingPosition", () => {
  it("снизу, по началу якоря", () => {
    const r = computeFloatingPosition({
      anchor: { x: 100, y: 100, width: 40, height: 40 },
      floating,
      viewport,
      side: "bottom",
      align: "start",
      offset: 8,
    });
    expect(r).toEqual({ x: 100, y: 148, side: "bottom" });
  });

  it("сверху по центру", () => {
    const r = computeFloatingPosition({
      anchor: { x: 400, y: 400, width: 40, height: 40 },
      floating,
      viewport,
      side: "top",
      offset: 6,
    });
    expect(r).toEqual({ x: 320, y: 294, side: "top" });
  });

  it("переворачивается наверх у нижнего края окна", () => {
    const r = computeFloatingPosition({
      anchor: { x: 400, y: 740, width: 40, height: 40 },
      floating,
      viewport,
      side: "bottom",
      offset: 8,
    });
    expect(r.side).toBe("top");
    expect(r.y).toBe(740 - 100 - 8);
  });

  it("не переворачивается, если с другой стороны места ещё меньше — прижимается к краю", () => {
    const r = computeFloatingPosition({
      anchor: { x: 400, y: 60, width: 40, height: 680 },
      floating,
      viewport,
      side: "bottom",
      offset: 8,
      padding: 8,
    });
    expect(r.side).toBe("bottom");
    expect(r.y).toBe(800 - 100 - 8);
  });

  it("прижимается к правому краю окна", () => {
    const r = computeFloatingPosition({
      anchor: { x: 960, y: 100, width: 30, height: 30 },
      floating,
      viewport,
      side: "bottom",
      align: "start",
      padding: 8,
    });
    expect(r.x).toBe(1000 - 200 - 8);
  });

  it("слева от якоря и переворот вправо у левого края", () => {
    const left = computeFloatingPosition({
      anchor: { x: 500, y: 300, width: 40, height: 40 },
      floating,
      viewport,
      side: "left",
      offset: 10,
    });
    expect(left).toEqual({ x: 290, y: 270, side: "left" });

    const flipped = computeFloatingPosition({
      anchor: { x: 20, y: 300, width: 40, height: 40 },
      floating,
      viewport,
      side: "left",
      offset: 10,
    });
    expect(flipped.side).toBe("right");
    expect(flipped.x).toBe(70);
  });

  it("точка-курсор как якорь", () => {
    const r = computeFloatingPosition({
      anchor: pointRect(300, 300),
      floating,
      viewport,
      side: "bottom",
      align: "start",
      offset: 4,
    });
    expect(r).toEqual({ x: 300, y: 304, side: "bottom" });
  });
});
