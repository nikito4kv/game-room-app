import { describe, expect, it } from "vitest";
import { badgeTextColor, contrastRatio, relativeLuminance } from "./badgeColor";

describe("цвет текста бейджа", () => {
  it("яркость крайних цветов", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1);
    expect(relativeLuminance("red")).toBeNull();
    expect(contrastRatio(1, 0)).toBeCloseTo(21);
  });

  it("на светлом — тёмный текст, на тёмном — белый", () => {
    expect(badgeTextColor("#ffd400")).toBe("#111111");
    expect(badgeTextColor("#f5f5f5")).toBe("#111111");
    expect(badgeTextColor("#1a237e")).toBe("#ffffff");
    expect(badgeTextColor("#7b1fa2")).toBe("#ffffff");
    expect(badgeTextColor("#zzz")).toBeNull();
  });
});
