import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PAINT_COLOR, PAINT_BASE, PAINT_PALETTE, snapToPalette } from "./palette";

const tokens = readFileSync(new URL("../../../design-system/tokens.css", import.meta.url), "utf8");

describe("палитра рисовалки", () => {
  it("некрашеный Румик в рисунке того же цвета, что токен --gr-rumik-white", () => {
    const token = /--gr-rumik-white:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1];
    expect(token?.toLowerCase()).toBe(PAINT_BASE);
    expect(PAINT_PALETTE[0].hex).toBe(PAINT_BASE);
  });

  it("цвета — #rrggbb в нижнем регистре, без повторов; кисть по умолчанию из палитры", () => {
    for (const s of PAINT_PALETTE) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(PAINT_PALETTE.map((s) => s.hex)).size).toBe(PAINT_PALETTE.length);
    expect(PAINT_PALETTE.some((s) => s.hex === DEFAULT_PAINT_COLOR)).toBe(true);
  });

  it("пипетка: цвет в пределах ±2 от палитры становится цветом палитры", () => {
    expect(snapToPalette("#e5474d")).toBe("#e5484d");
    expect(snapToPalette("#e7464b")).toBe("#e5484d");
    expect(snapToPalette("#e5484d")).toBe("#e5484d");
    // Дальше — свой цвет, как есть.
    expect(snapToPalette("#e5444d")).toBe("#e5444d");
    expect(snapToPalette("#123456")).toBe("#123456");
  });
});
