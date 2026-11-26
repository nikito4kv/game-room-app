import { describe, it, expect } from "vitest";
import { formatKeyCode, reservedKeyReason } from "@/lib/keys";

describe("reservedKeyReason", () => {
  it("служебные клавиши и клавиши просмотра демонстрации назначить нельзя", () => {
    for (const code of ["Escape", "Tab", "KeyF", "Equal", "Minus", "Digit0", "NumpadAdd", "Numpad0"]) {
      expect(reservedKeyReason(code)).not.toBeNull();
    }
  });
  it("Ctrl, Alt и Win — нельзя (сочетания браузера), Shift — можно", () => {
    expect(reservedKeyReason("ControlLeft")).toMatch(/Ctrl/);
    expect(reservedKeyReason("AltRight")).not.toBeNull();
    expect(reservedKeyReason("MetaLeft")).not.toBeNull();
    expect(reservedKeyReason("ShiftLeft")).toBeNull();
  });
  it("обычные клавиши свободны", () => {
    for (const code of ["KeyM", "KeyV", "Space", "Backquote", "F5", "Enter"]) {
      expect(reservedKeyReason(code)).toBeNull();
    }
  });
});

describe("formatKeyCode", () => {
  it("буквы: KeyM → M", () => {
    expect(formatKeyCode("KeyM")).toBe("M");
    expect(formatKeyCode("KeyV")).toBe("V");
  });

  it("цифры верхнего ряда: Digit2 → 2", () => {
    expect(formatKeyCode("Digit2")).toBe("2");
    expect(formatKeyCode("Digit0")).toBe("0");
  });

  it("цифровой блок: Numpad5 → Num 5", () => {
    expect(formatKeyCode("Numpad5")).toBe("Num 5");
  });

  it("функциональные клавиши остаются как есть", () => {
    expect(formatKeyCode("F1")).toBe("F1");
    expect(formatKeyCode("F12")).toBe("F12");
  });

  it("стрелки превращаются в символы", () => {
    expect(formatKeyCode("ArrowUp")).toBe("↑");
    expect(formatKeyCode("ArrowLeft")).toBe("←");
  });

  it("именованные клавиши получают короткую подпись", () => {
    expect(formatKeyCode("Enter")).toBe("Enter");
    expect(formatKeyCode("Escape")).toBe("Esc");
    expect(formatKeyCode("Backquote")).toBe("`");
    expect(formatKeyCode("Space")).toBe("Space");
  });

  it("модификаторы: ShiftLeft → Shift, ControlRight → Ctrl", () => {
    expect(formatKeyCode("ShiftLeft")).toBe("Shift");
    expect(formatKeyCode("ControlRight")).toBe("Ctrl");
    expect(formatKeyCode("AltLeft")).toBe("Alt");
  });

  it("неизвестный код возвращается как есть и не падает", () => {
    expect(formatKeyCode("SomethingWeird")).toBe("SomethingWeird");
    expect(formatKeyCode("")).toBe("");
  });
});
