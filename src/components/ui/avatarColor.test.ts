import { describe, expect, it } from "vitest";
import {
  AVATAR_COLORS,
  assignAvatarColors,
  avatarColorIndex,
  avatarColorVar,
  initialsOf,
} from "./avatarColor";

describe("avatarColorIndex", () => {
  it("стабилен и не зависит от регистра и пробелов по краям", () => {
    expect(avatarColorIndex("Тёма")).toBe(avatarColorIndex("тёма"));
    expect(avatarColorIndex("  Тёма ")).toBe(avatarColorIndex("Тёма"));
  });

  it("всегда в пределах палитры", () => {
    for (const seed of ["", "a", "Вася", "xX_Sniper_Xx", "🔥", "очень длинный ник игрока"]) {
      const i = avatarColorIndex(seed);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(AVATAR_COLORS);
    }
  });

  it("разносит разные ники по разным цветам (на большой выборке все цвета в ходу)", () => {
    const used = new Set(Array.from({ length: 200 }, (_, k) => avatarColorIndex(`игрок${k}`)));
    expect(used.size).toBe(AVATAR_COLORS);
  });
});

describe("assignAvatarColors", () => {
  it("первый пришедший сохраняет свой цвет, второй с тем же цветом сдвигается", () => {
    // Ищем два ника с одинаковым хэш-цветом — так проверка не зависит от хэша.
    const base = avatarColorIndex("Тёма");
    let twin = "";
    for (let k = 0; k < 1000 && !twin; k++) {
      if (avatarColorIndex(`ник${k}`) === base) twin = `ник${k}`;
    }
    expect(twin).not.toBe("");
    const [a, b] = assignAvatarColors(["Тёма", twin]);
    expect(a).toBe(base);
    expect(b).toBe((base + 1) % AVATAR_COLORS);
  });

  it("до 10 человек цвета не повторяются", () => {
    const seeds = Array.from({ length: 10 }, (_, k) => `друг${k}`);
    expect(new Set(assignAvatarColors(seeds)).size).toBe(10);
  });

  it("одиннадцатый получает свой хэш-цвет (повтор допустим, зацикливания нет)", () => {
    const seeds = Array.from({ length: 11 }, (_, k) => `друг${k}`);
    const colors = assignAvatarColors(seeds);
    expect(colors).toHaveLength(11);
    expect(colors[10]).toBe(avatarColorIndex("друг10"));
  });

  it("одинаковый результат для одинакового порядка", () => {
    const seeds = ["Даня", "Ника", "Лёха"];
    expect(assignAvatarColors(seeds)).toEqual(assignAvatarColors([...seeds]));
  });
});

describe("avatarColorVar", () => {
  it("строит ссылку на токен и не выходит за палитру", () => {
    expect(avatarColorVar(3)).toBe("var(--gr-avatar-3)");
    expect(avatarColorVar(13)).toBe("var(--gr-avatar-3)");
    expect(avatarColorVar(-1)).toBe("var(--gr-avatar-9)");
  });
});

describe("initialsOf", () => {
  it.each([
    ["Тёма", "Т"],
    ["Даня Котов", "ДК"],
    ["night owl", "NO"],
    ["NightOwl", "NO"],
    ["xX_Sniper_Xx", "XS"],
    ["ёжик", "Ё"],
    ["🔥Вася", "В"],
    ["123", "1"],
    // Год и номер — не часть имени.
    ["Лёха_2007", "Л"],
    ["Player 2", "P"],
    ["2007 Лёха", "Л"],
    ["   ", "?"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
