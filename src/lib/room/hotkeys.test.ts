import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDS } from "@/lib/clientStorage";
import { actionForKey, isNativeActivationKey, isTypingTarget } from "./hotkeys";

// В node-окружении DOM нет — узлы подменяем объектами с нужными полями.
const node = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget;

describe("isTypingTarget", () => {
  it("поля ввода — да", () => {
    expect(isTypingTarget(node("INPUT"))).toBe(true);
    expect(isTypingTarget(node("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(node("SELECT"))).toBe(true);
    expect(isTypingTarget(node("DIV", true))).toBe(true);
  });

  it("кнопки, обычные узлы и пустая цель — нет", () => {
    expect(isTypingTarget(node("BUTTON"))).toBe(false);
    expect(isTypingTarget(node("BODY"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("actionForKey", () => {
  it("находит действие по коду клавиши", () => {
    expect(actionForKey(DEFAULT_KEYBINDS, "KeyM")).toBe("mic");
    expect(actionForKey(DEFAULT_KEYBINDS, "KeyD")).toBe("deafen");
    expect(actionForKey(DEFAULT_KEYBINDS, "KeyS")).toBe("screen");
    expect(actionForKey(DEFAULT_KEYBINDS, "Enter")).toBe("chat");
    expect(actionForKey(DEFAULT_KEYBINDS, "KeyV")).toBe("ptt");
  });

  it("учитывает переназначенные клавиши", () => {
    const binds = { ...DEFAULT_KEYBINDS, mic: "F2" };
    expect(actionForKey(binds, "F2")).toBe("mic");
    expect(actionForKey(binds, "KeyM")).toBeUndefined();
  });

  it("свободная клавиша → undefined", () => {
    expect(actionForKey(DEFAULT_KEYBINDS, "KeyQ")).toBeUndefined();
  });
});

describe("isNativeActivationKey", () => {
  it("Enter и Space активируют кнопки сами", () => {
    expect(isNativeActivationKey("Enter")).toBe(true);
    expect(isNativeActivationKey("Space")).toBe(true);
    expect(isNativeActivationKey("KeyT")).toBe(false);
  });
});
