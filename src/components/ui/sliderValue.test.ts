import { describe, expect, it } from "vitest";
import { sliderValue } from "./sliderValue";

describe("sliderValue", () => {
  const volume = { marks: [100], snap: 4 };

  it("мышью рядом с риской — примагничивает", () => {
    expect(sliderValue(97, { ...volume, input: "pointer" })).toBe(100);
    expect(sliderValue(104, { ...volume, input: "pointer" })).toBe(100);
    expect(sliderValue(95, { ...volume, input: "pointer" })).toBe(95);
  });

  it("стрелками с риски можно уйти: шаг меньше магнита не застревает", () => {
    // Было: 100 → ← → 99 → магнит → снова 100, и так на каждое нажатие.
    expect(sliderValue(99, { ...volume, input: "keyboard" })).toBe(99);
    expect(sliderValue(101, { ...volume, input: "keyboard" })).toBe(101);
    // Подстройка порога: шаг 1, магнит 1 у нуля.
    expect(sliderValue(-1, { marks: [0], snap: 1, input: "keyboard" })).toBe(-1);
  });

  it("без рисок или магнита — как есть", () => {
    expect(sliderValue(42, { input: "pointer" })).toBe(42);
    expect(sliderValue(99, { marks: [100], input: "pointer" })).toBe(99);
  });
});
