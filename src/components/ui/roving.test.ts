import { describe, expect, it } from "vitest";
import { nextIndex, rovingKey } from "./roving";

describe("rovingKey", () => {
  it("горизонтальная группа слушает ←/→", () => {
    expect(rovingKey("ArrowRight", "horizontal")).toBe("next");
    expect(rovingKey("ArrowLeft", "horizontal")).toBe("prev");
    expect(rovingKey("ArrowDown", "horizontal")).toBeNull();
  });

  it("вертикальная — ↑/↓, обе — все четыре", () => {
    expect(rovingKey("ArrowDown", "vertical")).toBe("next");
    expect(rovingKey("ArrowRight", "vertical")).toBeNull();
    expect(rovingKey("ArrowUp", "both")).toBe("prev");
    expect(rovingKey("ArrowRight", "both")).toBe("next");
  });

  it("Home/End в любой ориентации", () => {
    expect(rovingKey("Home", "vertical")).toBe("first");
    expect(rovingKey("End", "horizontal")).toBe("last");
  });
});

describe("nextIndex", () => {
  const none = [false, false, false, false];

  it("ходит по кругу", () => {
    expect(nextIndex(3, "next", none)).toBe(0);
    expect(nextIndex(0, "prev", none)).toBe(3);
  });

  it("пропускает выключенные", () => {
    expect(nextIndex(0, "next", [false, true, true, false])).toBe(3);
    expect(nextIndex(3, "prev", [false, true, true, false])).toBe(0);
  });

  it("first/last учитывают выключенные", () => {
    expect(nextIndex(2, "first", [true, false, false, true])).toBe(1);
    expect(nextIndex(1, "last", [true, false, false, true])).toBe(2);
  });

  it("если всё выключено — остаётся на месте", () => {
    expect(nextIndex(1, "next", [true, true, true])).toBe(1);
  });
});
