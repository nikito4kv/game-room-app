import { describe, expect, it } from "vitest";
import { dbToFraction, formatDb, fractionToDb, nextPeak, rmsToDb, smoothLevelDb } from "./level";

describe("dbToFraction / fractionToDb", () => {
  it("линейно в дБ на шкале −60…0", () => {
    expect(dbToFraction(-60)).toBe(0);
    expect(dbToFraction(0)).toBe(1);
    expect(dbToFraction(-30)).toBe(0.5);
  });

  it("обрезает выход за шкалу и −∞", () => {
    expect(dbToFraction(-90)).toBe(0);
    expect(dbToFraction(6)).toBe(1);
    expect(dbToFraction(-Infinity)).toBe(0);
  });

  it("обратное преобразование", () => {
    expect(fractionToDb(0.5)).toBe(-30);
    expect(fractionToDb(2)).toBe(0);
    expect(fractionToDb(0.25, -80, 0)).toBe(-60);
  });
});

describe("rmsToDb", () => {
  it("1 → 0 дБ, 0.1 → −20 дБ, 0 → −∞", () => {
    expect(rmsToDb(1)).toBe(0);
    expect(rmsToDb(0.1)).toBeCloseTo(-20);
    expect(rmsToDb(0)).toBe(-Infinity);
  });
});

describe("smoothLevelDb", () => {
  it("растёт мгновенно", () => {
    expect(smoothLevelDb(-50, -20, 16)).toBe(-20);
  });

  it("спадает не быстрее заданной скорости", () => {
    expect(smoothLevelDb(-20, -60, 100, 36)).toBeCloseTo(-23.6);
  });

  it("не проваливается ниже цели", () => {
    expect(smoothLevelDb(-20, -21, 1000, 36)).toBe(-21);
  });

  it("с −∞ стартует прямо с цели", () => {
    expect(smoothLevelDb(-Infinity, -40, 16)).toBe(-40);
  });
});

describe("nextPeak", () => {
  it("новый максимум сбрасывает удержание", () => {
    expect(nextPeak({ db: -30, heldMs: 500 }, -10, 16)).toEqual({ db: -10, heldMs: 0 });
  });

  it("держится, пока не вышло время удержания", () => {
    expect(nextPeak({ db: -10, heldMs: 100 }, -40, 100, 700)).toEqual({ db: -10, heldMs: 200 });
  });

  it("потом опускается, но не ниже текущего уровня", () => {
    const p = nextPeak({ db: -10, heldMs: 700 }, -40, 1000, 700, 18);
    expect(p.db).toBeCloseTo(-28);
    expect(nextPeak({ db: -10, heldMs: 700 }, -12, 1000, 700, 18).db).toBe(-12);
  });
});

describe("formatDb", () => {
  it("знак минуса и неразрывный пробел", () => {
    expect(formatDb(-42.4)).toBe("−42 дБ");
    expect(formatDb(0)).toBe("0 дБ");
    expect(formatDb(-Infinity)).toBe("−∞ дБ");
  });
});
