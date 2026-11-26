import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARM, HAND_R, PARTS, POSES, VIEW, handAt, partTransform, type Shoulder } from "@/lib/rumik/geometry";
import {
  RUMIK_EXTRAS,
  RUMIK_EYES,
  RUMIK_HATS,
  RUMIK_POSES,
  Rumik,
  rumikColorIndex,
  rumikPalette,
  type RumikProps,
} from "./Rumik";

const html = (props: RumikProps = {}) => renderToStaticMarkup(createElement(Rumik, props));
/** «Сырой» цвет: #abc, #aabbcc, #aabbccdd. Ссылки на id (url(#rk…), href="#rk…") сюда не попадают: id начинается с «rk». */
const HEX = /#[0-9a-f]{3,8}\b/i;

describe("Rumik", () => {
  it("по умолчанию декоративный: aria-hidden, без role", () => {
    const out = html();
    expect(out).toContain('viewBox="-38 -26 286 240"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('role="img"');
  });

  it("с подписью — картинка для скринридера", () => {
    const out = html({ label: "Румик машет" });
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Румик машет"');
    expect(out).not.toContain("aria-hidden");
  });

  it("один цвет — всё тело одного цвета, без деления на четверти", () => {
    const out = html({ colors: 3 });
    expect(out).toContain("var(--gr-avatar-3)");
    expect(out).not.toMatch(/--gr-avatar-[0-24-9]\)/);
    expect(out).not.toContain("clipPath");
  });

  it("четыре цвета — четверти тела через clipPath", () => {
    const out = html({ colors: [0, 1, 6, 3] });
    for (const i of [0, 1, 6, 3]) expect(out).toContain(`var(--gr-avatar-${i})`);
    expect(out).toContain("<clipPath");
  });

  it("white — некрашеный Румик из токена бренд-слоя", () => {
    const out = html({ colors: "white" });
    expect(out).toContain("var(--gr-rumik-white)");
    expect(out).not.toMatch(/--gr-avatar-\d/);
  });

  it("индекс цвета заворачивается по кругу и округляется", () => {
    expect(rumikColorIndex(12)).toBe(2);
    expect(rumikColorIndex(-1)).toBe(9);
    expect(rumikColorIndex(3.6)).toBe(4);
    expect(rumikColorIndex(Number.NaN)).toBe(0);
    expect(rumikPalette([7])).toEqual(Array(4).fill("var(--gr-avatar-7)"));
    expect(rumikPalette([1, 2])).toEqual([
      "var(--gr-avatar-1)",
      "var(--gr-avatar-2)",
      "var(--gr-avatar-2)",
      "var(--gr-avatar-2)",
    ]);
    expect(rumikPalette([])).toEqual(Array(4).fill("var(--gr-avatar-6)"));
  });

  it("каждая поза рисуется и меняет положение кистей", () => {
    const hands = new Set<string>();
    for (const pose of RUMIK_POSES) {
      const out = html({ pose });
      const circles = [...out.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="15"/g)].map((m) => `${m[1]},${m[2]}`);
      expect(circles.length).toBeGreaterThanOrEqual(2);
      hands.add(circles.join(" "));
    }
    expect(hands.size).toBe(RUMIK_POSES.length);
  });

  it("сидит — ноги разведены", () => {
    expect(html({ pose: "sit" })).toContain("rotate(9 77 140)");
    expect(html({ pose: "stand" })).not.toContain("rotate(9 77 140)");
  });

  it("кисть — на конце руки", () => {
    const [x, y] = handAt(POSES.stand.l);
    expect(Math.hypot(x - POSES.stand.l[0], y - POSES.stand.l[1])).toBeCloseTo(ARM.len, 5);
  });

  it("отражённая фигура не выходит за рамку сильнее, чем обычная", () => {
    // Самая дальняя точка — кисть показывающей руки с краем наклейки (+9,5).
    const out = html({ pose: "point", flip: true, sticker: true });
    const mirror = Number(/matrix\(-1 0 0 1 ([\d.]+) 0\)/.exec(out)?.[1]);
    const hands = [...out.matchAll(/<circle cx="([-\d.]+)" cy="[-\d.]+" r="15"/g)].map((m) => Number(m[1]));
    const farRight = Math.max(...hands) + HAND_R + 9.5;
    const overflowRight = farRight - (VIEW.x + VIEW.w);
    const overflowLeftWhenFlipped = VIEW.x - (mirror - farRight);
    expect(overflowLeftWhenFlipped).toBeLessThanOrEqual(overflowRight + 0.01);
    expect(overflowRight).toBeLessThan(5);
  });

  it("взгляд — в координатах экрана: с flip глаза смотрят туда же", () => {
    expect(html({ look: [3, 0] })).toContain("translate(3 0)");
    expect(html({ look: [3, 0], flip: true })).toContain("translate(-3 0)");
  });

  it("id силуэта содержит позу: совпавший счётчик useId не подменит чужую позу", () => {
    expect(html({ pose: "wave" })).toMatch(/id="rkwave[^"]*s"/);
  });

  it("волн у лица нет (решение автора); speak — только крупный лаймовый круг", () => {
    const out = html({ eyes: "speak" });
    expect(out).toContain('r="14.5"');
    expect(out).not.toContain('r="24.5"');
  });

  it("каждые глаза, шапка и значок дают свою картинку", () => {
    const eyes = new Set(RUMIK_EYES.map((e) => html({ eyes: e })));
    expect(eyes.size).toBe(RUMIK_EYES.length);
    const hats = new Set(RUMIK_HATS.map((h) => html({ hat: h })));
    expect(hats.size).toBe(RUMIK_HATS.length);
    const extras = new Set(RUMIK_EXTRAS.map((x) => html({ extra: x })));
    expect(extras.size).toBe(RUMIK_EXTRAS.length);
  });

  it("корона — цветом короны хоста, «говорит» — лаймом signal", () => {
    expect(html({ hat: "crown" })).toContain("var(--gr-crown)");
    expect(html({ glow: true })).toContain("fill:var(--gr-signal);stroke:var(--gr-signal)");
    expect(html({ eyes: "muted" })).toContain("var(--gr-alert)");
  });

  it("наклейка — белый край; «говорит» важнее наклейки", () => {
    expect(html({ sticker: true })).toContain("var(--gr-rumik-sticker)");
    const both = html({ sticker: true, glow: true });
    expect(both).not.toContain("var(--gr-rumik-sticker)");
    expect(both).toContain("radialGradient");
  });

  it("flip отражает фигуру, а буквы в значке остаются читаемыми", () => {
    const out = html({ flip: true, extra: "q" });
    // Отражение вокруг середины рамки (x = 105), как scaleX(-1) у всего SVG.
    expect(out).toContain("matrix(-1 0 0 1 210 0)");
    // Значок «?» стоит зеркально слева (210 − 180), наклон тоже зеркальный.
    expect(out).toContain("translate(30 12) rotate(-8)");
  });

  it("взгляд и наклон ограничены", () => {
    expect(html({ look: [40, -40] })).toContain("translate(4 -4)");
    expect(html({ tilt: 90 })).toContain("rotate(15 100 110)");
  });

  it("size задаёт ширину и высоту по пропорции, без него — во всю ширину", () => {
    const sized = html({ size: 286 });
    expect(sized).toContain('width="286"');
    expect(sized).toContain('height="240"');
    expect(html()).toContain("w-full");
  });

  it("у двух Румиков на странице разные id", () => {
    const out = renderToStaticMarkup(
      createElement("div", null, createElement(Rumik, { colors: [1, 2] }), createElement(Rumik, { colors: [3, 4] })),
    );
    const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("рисунок ложится по частям: семь обрезок и картинка в каждой части", () => {
    const out = html({ colors: "white", paint: "/api/avatar/abc", pose: "wave" });
    expect(out.match(/<clipPath id="[^"]+p\d"/g)?.length).toBe(7);
    expect(out.match(/<image /g)?.length).toBe(9); // руки — дважды: видимая часть и отражение спрятанной
    expect(out).toContain('href="/api/avatar/abc"');
    // Без рисунка — ни обрезок частей, ни картинок.
    expect(html({ pose: "wave" })).not.toContain("<image");
  });

  it("краска руки и кисти уезжает в позу вместе с ними", () => {
    // Применяем transform вида translate(bx by) rotate(d) translate(-ax -ay) к точке.
    const apply = (t: string | undefined, [x, y]: [number, number]): [number, number] => {
      if (!t) return [x, y]; // часть в этой позе не двигается
      const n = t.match(/-?[\d.]+/g)!.map(Number);
      const [bx, by, d, tx, ty] = n;
      const r = (d * Math.PI) / 180;
      const px = x + tx;
      const py = y + ty;
      return [bx + px * Math.cos(r) - py * Math.sin(r), by + px * Math.sin(r) + py * Math.cos(r)];
    };
    for (const pose of ["wave", "cheer", "point", "sit", "hold"] as const) {
      for (const side of ["l", "r"] as const) {
        const hand = partTransform(pose, side === "l" ? "handL" : "handR");
        const [x, y] = apply(hand, handAt(POSES.stand[side]));
        const [ex, ey] = handAt(POSES[pose][side] as Shoulder);
        expect(x).toBeCloseTo(ex, 1);
        expect(y).toBeCloseTo(ey, 1);
        const arm = partTransform(pose, side === "l" ? "armL" : "armR");
        const [sx, sy] = apply(arm, [POSES.stand[side][0], POSES.stand[side][1]]);
        expect(sx).toBeCloseTo(POSES[pose][side][0], 1);
        expect(sy).toBeCloseTo(POSES[pose][side][1], 1);
      }
    }
    expect(PARTS.map((p) => partTransform("stand", p)).every((t) => t === undefined)).toBe(true);
    expect(partTransform("sit", "legL")).toBe("rotate(9 77 140)");
  });

  it("рамка «голова» — квадрат", () => {
    const out = html({ frame: "head", size: 32 });
    expect(out).toContain('viewBox="24 -18 152 152"');
    expect(out).toContain('width="32"');
    expect(out).toContain('height="32"');
  });

  it("ни одного «сырого» hex ни в каком сочетании параметров", () => {
    for (const pose of RUMIK_POSES) {
      for (const eyes of RUMIK_EYES) {
        const out = html({ pose, eyes, colors: [0, 4, 8, 2], sticker: true, flip: pose === "wave" });
        expect(out).not.toMatch(HEX);
      }
    }
    for (const hat of RUMIK_HATS) expect(html({ hat, glow: true })).not.toMatch(HEX);
    for (const extra of RUMIK_EXTRAS) expect(html({ extra, colors: "white" })).not.toMatch(HEX);
  });

  it("в исходниках Румика нет hex: цвета только из токенов", () => {
    for (const file of ["src/components/ui/Rumik.tsx", "src/lib/rumik/geometry.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(HEX);
    }
  });

  it("токены бренд-слоя есть в tokens.css", () => {
    const css = readFileSync("design-system/tokens.css", "utf8");
    for (const t of ["--gr-rumik-eye", "--gr-rumik-white", "--gr-rumik-sticker"]) expect(css).toContain(`${t}:`);
  });
});
