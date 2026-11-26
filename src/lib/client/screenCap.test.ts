import { describe, expect, it } from "vitest";
import { clampScreenQuality, isQualityAllowed, isScreenQualityCap } from "./screenCap";

describe("потолок качества показа", () => {
  it("1440p — можно всё", () => {
    for (const q of ["light", "smooth", "max", "text"] as const) expect(isQualityAllowed(q, "1440p")).toBe(true);
  });

  it("1080p — без Максимума и Текста (до 1440p)", () => {
    expect(isQualityAllowed("smooth", "1080p")).toBe(true);
    expect(isQualityAllowed("max", "1080p")).toBe(false);
    expect(isQualityAllowed("text", "1080p")).toBe(false);
    expect(clampScreenQuality("max", "1080p")).toBe("smooth");
    expect(clampScreenQuality("text", "1080p")).toBe("smooth");
  });

  it("720p — только Лёгкий", () => {
    expect(clampScreenQuality("smooth", "720p")).toBe("light");
    expect(clampScreenQuality("light", "720p")).toBe("light");
  });

  it("проверка значения потолка", () => {
    expect(isScreenQualityCap("1080p")).toBe(true);
    expect(isScreenQualityCap("4k")).toBe(false);
  });
});
