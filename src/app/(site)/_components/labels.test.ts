import { describe, expect, it } from "vitest";
import { FALLBACK_ROOM_TITLE, codeNoteText, defaultRoomTitle, visitedLabel } from "./labels";

// Местное время: тест не зависит от часового пояса машины.
const at = (month: number, day: number, hour = 12, year = 2026) => new Date(year, month - 1, day, hour).getTime();
const NOW = at(10, 1, 21);

describe("defaultRoomTitle", () => {
  it("по нику, ник не склоняем", () => {
    expect(defaultRoomTitle("Тёма")).toBe("Тёма и друзья");
    expect(defaultRoomTitle("  Даня Котов ")).toBe("Даня Котов и друзья");
  });

  it("без ника — нейтральное название", () => {
    expect(defaultRoomTitle(null)).toBe(FALLBACK_ROOM_TITLE);
    expect(defaultRoomTitle("   ")).toBe(FALLBACK_ROOM_TITLE);
  });

  it("слишком длинный ник из хранилища не раздувает название за 40 символов", () => {
    const title = defaultRoomTitle("Я".repeat(60));
    expect(Array.from(title).length).toBeLessThanOrEqual(40);
    expect(title.endsWith(" и друзья")).toBe(true);
  });
});

describe("visitedLabel", () => {
  it("сегодня и вчера — по календарю, а не по 24 часам", () => {
    expect(visitedLabel(at(10, 1, 0), NOW)).toBe("сегодня");
    expect(visitedLabel(at(9, 30, 23), at(10, 1, 0, 2026) + 60_000)).toBe("вчера");
    expect(visitedLabel(at(9, 30, 9), NOW)).toBe("вчера");
  });

  it("дни и недели со склонением", () => {
    expect(visitedLabel(at(9, 28), NOW)).toBe("3 дня назад");
    expect(visitedLabel(at(9, 26), NOW)).toBe("5 дней назад");
    expect(visitedLabel(at(9, 24), NOW)).toBe("неделю назад");
    expect(visitedLabel(at(9, 17), NOW)).toBe("2 недели назад");
    expect(visitedLabel(at(9, 10), NOW)).toBe("3 недели назад");
  });

  it("давно — дата, другой год — с годом", () => {
    expect(visitedLabel(at(9, 1), NOW)).toBe("1 сентября");
    expect(visitedLabel(at(12, 31, 12, 2025), NOW)).toBe("31 декабря 2025 г.");
  });

  it("время из будущего — сегодня", () => {
    expect(visitedLabel(NOW + 3 * 86_400_000, NOW)).toBe("сегодня");
  });
});

describe("codeNoteText", () => {
  it("на каждую причину — свой текст, без причины — ничего", () => {
    expect(codeNoteText("layout")).toMatch(/раскладка/);
    expect(codeNoteText("confusable")).toMatch(/0, 1/);
    expect(codeNoteText("invalid")).toMatch(/латинские/);
    expect(codeNoteText("link")).toMatch(/ссылке/);
    expect(codeNoteText(null)).toBeUndefined();
  });
});
