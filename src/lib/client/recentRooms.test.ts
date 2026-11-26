import { describe, expect, it } from "vitest";
import { RECENT_LIMIT, isRecentRoomList, upsertRecentRoom, type RecentRoom } from "./recentRooms";

const room = (code: string, visitedAt: number, people?: string[]): RecentRoom => ({
  code,
  title: `Комната ${code}`,
  visitedAt,
  ...(people ? { people } : {}),
});

describe("upsertRecentRoom", () => {
  it("кладёт новую комнату наверх", () => {
    const next = upsertRecentRoom([room("AAAAAA", 1)], { code: "BBBBBB", title: "Катка" }, 10);
    expect(next.map((r) => r.code)).toEqual(["BBBBBB", "AAAAAA"]);
    expect(next[0]).toEqual({ code: "BBBBBB", title: "Катка", visitedAt: 10 });
  });

  it("повторный вход поднимает комнату без дубля и обновляет время и название", () => {
    const list = [room("AAAAAA", 5), room("BBBBBB", 3)];
    const next = upsertRecentRoom(list, { code: "bbbbbb", title: "Новое имя" }, 20);
    expect(next.map((r) => r.code)).toEqual(["BBBBBB", "AAAAAA"]);
    expect(next[0].title).toBe("Новое имя");
    expect(next[0].visitedAt).toBe(20);
  });

  it(`помнит не больше ${RECENT_LIMIT} комнат`, () => {
    const list = ["A", "B", "C", "D", "E"].map((c, i) => room(c.repeat(6), 10 - i));
    const next = upsertRecentRoom(list, { code: "FFFFFF", title: "Ещё" }, 100);
    expect(next).toHaveLength(RECENT_LIMIT);
    expect(next[0].code).toBe("FFFFFF");
    expect(next.some((r) => r.code === "EEEEEE")).toBe(false);
  });

  it("берёт до 4 ников и чистит пустые", () => {
    const next = upsertRecentRoom(
      [],
      { code: "AAAAAA", title: "Т", people: ["Тёма", " ", "Ника", "Лёха", "Даня", "Саня"] },
      1,
    );
    expect(next[0].people).toEqual(["Тёма", "Ника", "Лёха", "Даня"]);
  });

  it("пустой состав не затирает прежний (вышел последним)", () => {
    const list = [room("AAAAAA", 1, ["Тёма"])];
    const next = upsertRecentRoom(list, { code: "AAAAAA", title: "Т", people: [] }, 2);
    expect(next[0].people).toEqual(["Тёма"]);
  });

  it("без кода или названия ничего не меняет", () => {
    const list = [room("AAAAAA", 1)];
    expect(upsertRecentRoom(list, { code: " ", title: "Т" }, 2)).toEqual(list);
    expect(upsertRecentRoom(list, { code: "BBBBBB", title: "  " }, 2)).toEqual(list);
  });
});

describe("isRecentRoomList", () => {
  it("принимает правильный список", () => {
    expect(isRecentRoomList([room("AAAAAA", 1, ["Тёма"]), room("BBBBBB", 2)])).toBe(true);
    expect(isRecentRoomList([])).toBe(true);
  });

  it("отвергает испорченное", () => {
    expect(isRecentRoomList(null)).toBe(false);
    expect(isRecentRoomList({})).toBe(false);
    expect(isRecentRoomList([{ code: "AAAAAA", title: "Т" }])).toBe(false);
    expect(isRecentRoomList([{ code: "", title: "Т", visitedAt: 1 }])).toBe(false);
    expect(isRecentRoomList([{ code: "A", title: "Т", visitedAt: 1, people: [1] }])).toBe(false);
    expect(isRecentRoomList([{ code: "A", title: "Т", visitedAt: Number.NaN }])).toBe(false);
  });
});
