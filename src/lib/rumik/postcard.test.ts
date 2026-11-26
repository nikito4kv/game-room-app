import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Logo } from "@/components/ui/Logo";
import { Rumik } from "@/components/ui/Rumik";
import { RUMIK_ASPECT, RUMIK_POSES, VIEW, type RumikPose } from "./geometry";
import {
  POSTCARD_POSES,
  backdropSvg,
  POSTCARD_SIZE,
  POSTCARD_TOKENS,
  figureExtent,
  fitFontSize,
  inlineCssVars,
  postcardLayout,
  readPostcardColors,
  wrapSvg,
  type PostcardLayout,
} from "./postcard";

// Значения тёмной темы из tokens.css — как их вернул бы getComputedStyle.
const css = readFileSync(join(process.cwd(), "design-system", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const dark = css.slice(0, css.indexOf('[data-theme="light"]'));
const TOKENS = new Map([...dark.matchAll(/(--gr-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const read = (name: string) => TOKENS.get(name) ?? "";
const HEX = /#[0-9a-f]{3,8}\b/i;

describe("postcardLayout", () => {
  const inside = (L: PostcardLayout, b: { x: number; y: number; w: number; h: number }) =>
    b.x >= 0 && b.y >= 0 && b.x + b.w <= L.width && b.y + b.h <= L.height;

  it("размер для соцсетей 1200×630", () => {
    const L = postcardLayout();
    expect([L.width, L.height]).toEqual([POSTCARD_SIZE.width, POSTCARD_SIZE.height]);
  });

  it.each(POSTCARD_POSES.map((p) => p.pose))("%s: фигура целиком справа от текста и в открытке, не сплющена", (pose) => {
    const L = postcardLayout(pose);
    const scale = L.rumik.w / VIEW.w;
    const ext = figureExtent(pose);
    const left = L.rumik.x + (ext.left - VIEW.x) * scale;
    const right = L.rumik.x + (ext.right - VIEW.x) * scale;
    expect(left).toBeGreaterThan(L.title.x + L.title.maxWidth + 8);
    expect(right).toBeLessThan(L.width - 40);
    expect(L.rumik.w / L.rumik.h).toBeCloseTo(RUMIK_ASPECT, 2);
    // По вертикали рамка VIEW целиком в открытке; ноги на одной линии во всех позах.
    expect(L.rumik.y).toBeGreaterThan(0);
    expect(L.rumik.y + L.rumik.h).toBeLessThan(L.height);
    expect(L.floor.y + L.floor.ry).toBeLessThan(L.height);
    expect(L.floor.y).toBe(postcardLayout("stand").floor.y);
  });

  it("стоящий — крупно, широкие позы мельче, но не крохи", () => {
    const w = (pose: RumikPose) => postcardLayout(pose).rumik.w;
    expect(w("stand")).toBeGreaterThan(590);
    expect(w("hold")).toBeLessThan(w("stand"));
    expect(w("hold")).toBeGreaterThan(450);
  });

  it("руки «держит» шире, чем у стоящего", () => {
    const stand = figureExtent("stand");
    const hold = figureExtent("hold");
    expect(hold.left).toBeLessThan(stand.left);
    expect(hold.right).toBeGreaterThan(stand.right);
  });

  it("логотип наверху, заголовок под ним, адрес сайта внизу", () => {
    const L = postcardLayout();
    expect(inside(L, L.mark)).toBe(true);
    expect(inside(L, L.word)).toBe(true);
    expect(L.title.maxWidth).toBeGreaterThan(480);
    expect(L.mark.y + L.mark.h).toBeLessThan(L.title.y - L.title.size * 0.8);
    expect(L.title.y + L.title.lineHeight).toBeLessThan(L.site.y - L.site.size);
    expect(L.site.y).toBeLessThan(L.height);
  });

  it("надпись логотипа стоит справа от знака, как в Logo lockup", () => {
    const L = postcardLayout();
    expect(L.word.x).toBeGreaterThan(L.mark.x + L.mark.w);
    expect(L.word.y).toBeGreaterThan(L.mark.y);
    expect(L.word.y + L.word.h).toBeLessThanOrEqual(L.mark.y + L.mark.h + 4);
  });
});

describe("POSTCARD_POSES", () => {
  it("шесть поз из R5, все есть у Румика, без повторов", () => {
    const poses = POSTCARD_POSES.map((p) => p.pose);
    expect(poses).toEqual(["stand", "wave", "cheer", "sit", "point", "hold"]);
    poses.forEach((p) => expect(RUMIK_POSES).toContain(p));
    expect(new Set(POSTCARD_POSES.map((p) => p.label)).size).toBe(poses.length);
  });
});

describe("fitFontSize", () => {
  const measure = (size: number) => size * 4; // строка шириной в 4 кегля

  it("влезает — наибольший кегль", () => {
    expect(fitFontSize(measure, 1000, 124, 64)).toBe(124);
  });

  it("не влезает — уменьшает с шагом 2", () => {
    expect(fitFontSize(measure, 440, 124, 64)).toBe(110);
  });

  it("не меньше минимума", () => {
    expect(fitFontSize(measure, 10, 124, 64)).toBe(64);
  });
});

describe("readPostcardColors", () => {
  it("берёт значения токенов как есть", () => {
    const c = readPostcardColors(read);
    expect(c.canvas).toBe(TOKENS.get("--gr-canvas"));
    expect(c.ink).toBe(TOKENS.get("--gr-ink"));
    expect(c.fontBrand).toContain("Unbounded");
    expect(Object.keys(c)).toEqual(Object.keys(POSTCARD_TOKENS));
  });

  it("нет токена — ошибка, а не выдуманный цвет", () => {
    expect(() => readPostcardColors((n) => (n === "--gr-canvas" ? "" : "x"))).toThrow(/--gr-canvas/);
  });
});

describe("inlineCssVars", () => {
  it("подставляет значение, запасное и оставляет неизвестное", () => {
    const r = (n: string) => ({ "--a": "red", "--empty": " " })[n] ?? "";
    expect(inlineCssVars('style="fill: var(--a);"', r)).toBe('style="fill: red;"');
    expect(inlineCssVars("fill:var(--empty, rgb(1 2 3 / 0.5))", r)).toBe("fill:rgb(1 2 3 / 0.5)");
    expect(inlineCssVars("fill:var(--none)", r)).toBe("fill:var(--none)");
  });

  it("экранирует значение: оно попадает в атрибут", () => {
    const out = inlineCssVars('a="var(--f)"', () => '"Onest", sans-serif');
    expect(out).toBe('a="&quot;Onest&quot;, sans-serif"');
  });

  it("Румик с рисунком и логотип после подстановки — без единой ссылки на токены", () => {
    const paint = "data:image/png;base64,AAAA";
    const markup = [
      renderToStaticMarkup(createElement(Rumik, { colors: "white", paint, pose: "cheer", eyes: "wide", sticker: true })),
      renderToStaticMarkup(createElement(Logo, { variant: "mark" })),
      renderToStaticMarkup(createElement(Logo, { variant: "wordmark" })),
    ].join("");
    expect(markup).toContain("var(--gr-");
    const out = inlineCssVars(markup, read);
    expect(out).not.toContain("var(");
    expect(out).toContain(TOKENS.get("--gr-rumik-white"));
    expect(out).toContain(TOKENS.get("--gr-signal"));
    expect(out).toContain(paint);
  });
});

describe("backdropSvg", () => {
  it("лампа и коврик — только на токенах; лампа гаснет прозрачностью, а не к чёрному", () => {
    const L = postcardLayout();
    const out = backdropSvg(L);
    expect(out).toContain("stop-color:var(--gr-glow)");
    expect(out).toContain('stop-opacity="0"');
    expect(out).not.toContain("transparent");
    expect(out).toContain(`cx="${L.floor.x}"`);
    expect(inlineCssVars(out, read)).not.toContain("var(");
  });
});

describe("wrapSvg", () => {
  it("рамка открытки, currentColor — из color", () => {
    const out = wrapSvg(1200, 630, "rgb(1 2 3)", ["<g/>"]);
    expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630"/);
    expect(out).toContain('style="color:rgb(1 2 3)"');
    expect(out).toContain("<g/></svg>");
  });
});

describe("postcard.ts", () => {
  it("ни одного своего цвета: всё из токенов", () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "rumik", "postcard.ts"), "utf8");
    expect(src).not.toMatch(HEX);
    expect(src).not.toMatch(/rgba?\(\s*\d/);
  });
});
