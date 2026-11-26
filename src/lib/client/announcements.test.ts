import { describe, expect, it } from "vitest";
import { DISMISSED_LIMIT, addDismissed, canDismissForever, parseAnnouncements, visibleAnnouncements } from "./announcements";

describe("announcements", () => {
  it("разбор: только правильные, без повторов, текст обрезан", () => {
    const list = parseAnnouncements([
      { id: "a", text: " Техработы ", level: "warning" },
      { id: "a", text: "дубль", level: "info" },
      { id: "b", text: "", level: "info" },
      { id: "c", text: "x", level: "loud" },
      null,
      { id: "d", text: "Новое", level: "info" },
    ]);
    expect(list).toEqual([
      { id: "a", text: "Техработы", level: "warning" },
      { id: "d", text: "Новое", level: "info" },
    ]);
    expect(parseAnnouncements("nope")).toEqual([]);
  });

  it("закрытые скрыты, важные сверху, при равной важности — порядок сервера", () => {
    const list = parseAnnouncements([
      { id: "i1", text: "1", level: "info" },
      { id: "w", text: "2", level: "warning" },
      { id: "c", text: "3", level: "critical" },
      { id: "i2", text: "4", level: "info" },
    ]);
    expect(visibleAnnouncements(list, ["w"]).map((a) => a.id)).toEqual(["c", "i1", "i2"]);
  });

  it("критическое навсегда не закрывается", () => {
    expect(canDismissForever("critical")).toBe(false);
    expect(canDismissForever("info")).toBe(true);
  });

  it("закрытые: без повторов и не больше лимита", () => {
    expect(addDismissed(["a", "b"], "a")).toEqual(["b", "a"]);
    const many = Array.from({ length: DISMISSED_LIMIT }, (_, i) => String(i));
    const next = addDismissed(many, "new");
    expect(next).toHaveLength(DISMISSED_LIMIT);
    expect(next[next.length - 1]).toBe("new");
    expect(next[0]).toBe("1");
  });
});
