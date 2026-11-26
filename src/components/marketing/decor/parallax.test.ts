import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecorWall } from "./DecorWall";
import { RIGHT_WALL_SHIFT, wallOffset, wallPhase } from "./parallax";

describe("wallOffset", () => {
  it("в начале страницы слой стоит на месте", () => {
    expect(wallOffset(0, 0.2, 230)).toBe(0);
  });

  it("едет вверх со своей скоростью", () => {
    expect(wallOffset(100, 0.2, 230)).toBe(-20);
    expect(wallOffset(100, 0.42, 320)).toBe(-42);
  });

  it("слои с разной скоростью сдвигаются по-разному", () => {
    const far = wallOffset(1500, 0.08, 190);
    const mid = wallOffset(1500, 0.2, 230);
    const near = wallOffset(1500, 0.42, 320);
    expect(new Set([far, mid, near]).size).toBe(3);
  });

  it("по модулю высоты плитки: сдвиг всегда в (−плитка, 0]", () => {
    for (const y of [0, 1, 999, 1150, 1500, 12345.6, 1e6]) {
      const v = wallOffset(y, 0.2, 230);
      expect(v).toBeLessThanOrEqual(0);
      expect(v).toBeGreaterThan(-230);
    }
    // Ровно одна плитка прокрутки — узор совпал с началом.
    expect(wallOffset(1150, 0.2, 230)).toBe(0);
    expect(wallOffset(1160, 0.2, 230)).toBe(-2);
  });

  it("начальная фаза добавляется к прокрутке", () => {
    expect(wallOffset(0, 0.2, 230, 104)).toBe(-104);
    expect(wallOffset(100, 0.2, 230, 104)).toBe(-124);
    expect(wallOffset(700, 0.2, 230, 104)).toBe(-14); // 140 + 104 = 244 → 14
  });

  it("оттяжка выше начала страницы не открывает щель сверху", () => {
    const v = wallOffset(-50, 0.42, 320);
    expect(v).toBeLessThanOrEqual(0);
    expect(v).toBeGreaterThan(-320);
    expect(v).toBe(-299);
  });

  it("мусор на входе не ломает раскладку", () => {
    expect(wallOffset(Number.NaN, 0.2, 230)).toBe(0);
    expect(wallOffset(100, 0.2, 0)).toBe(0);
    expect(Object.is(wallOffset(0, 0.2, 230), -0)).toBe(false);
  });
});

describe("wallPhase", () => {
  it("левая стена с нуля, правая сдвинута", () => {
    expect(wallPhase("left", 230)).toBe(0);
    expect(wallPhase("right", 230)).toBe(Math.round(230 * RIGHT_WALL_SHIFT));
  });
});

describe("DecorWall: разметка", () => {
  const html = renderToStaticMarkup(createElement(DecorWall));

  it("две полосы, обе скрыты от скринридера и мыши", () => {
    expect(html.match(/data-decor-wall=/g)).toHaveLength(2);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html.match(/pointer-events-none/g)).toHaveLength(2);
  });

  it("по три слоя в полосе, узор — плитка <pattern>", () => {
    expect(html.match(/<svg/g)).toHaveLength(6);
    expect(html.match(/<pattern/g)).toHaveLength(6);
    expect(html).toContain('patternUnits="userSpaceOnUse"');
  });

  it("цвета только из токенов: ни одного hex, обводки — палитра аватаров", () => {
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).toContain("stroke:var(--gr-avatar-0)");
    expect(html).not.toMatch(/\bfill="(?!none)/);
  });

  it("id узоров не повторяются", () => {
    const ids = [...html.matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(6);
  });
});
