import { describe, expect, it } from "vitest";
import type { PublicRoomSummary } from "@/lib/api/contract";
import { filterRooms, roomCapacity, roomRowLabel, roomStatus, roomsSummary } from "./roomList";

function room(over: Partial<PublicRoomSummary>): PublicRoomSummary {
  return {
    code: "K7QMP4",
    title: "Вечерняя катка",
    hostName: "Тёма",
    numParticipants: 3,
    maxParticipants: 10,
    createdAt: 0,
    locked: false,
    hasPassword: false,
    ...over,
  };
}

const OPEN = room({ code: "AAAAAA", title: "Rust с Даней", hostName: "Даня" });
const PASS = room({ code: "BBBBBB", title: "Сюда нельзя", hasPassword: true, hostName: "Ника" });
const LOCKED = room({ code: "CCCCCC", title: "Закрытая", locked: true, hasPassword: true });
const FULL = room({ code: "DDDDDD", title: "Битком", numParticipants: 10 });
const ALL = [OPEN, PASS, LOCKED, FULL];

describe("roomStatus", () => {
  it("замок важнее заполненности, заполненность — пароля", () => {
    expect(roomStatus(LOCKED)).toBe("locked");
    expect(roomStatus(FULL)).toBe("full");
    expect(roomStatus(room({ numParticipants: 10, hasPassword: true }))).toBe("full");
    expect(roomStatus(PASS)).toBe("password");
    expect(roomStatus(OPEN)).toBe("open");
  });

  it("без лимита у LiveKit — лимит сайта", () => {
    expect(roomCapacity(room({ maxParticipants: 0 }))).toBe(10);
    expect(roomStatus(room({ maxParticipants: 0, numParticipants: 10 }))).toBe("full");
  });
});

describe("filterRooms", () => {
  it("«Без пароля» — только те, куда войти сразу", () => {
    expect(filterRooms(ALL, "open", "")).toEqual([OPEN]);
  });

  it("«С паролем» — без запертых и полных", () => {
    expect(filterRooms(ALL, "password", "")).toEqual([PASS]);
  });

  it("«Все» — все", () => {
    expect(filterRooms(ALL, "all", "")).toEqual(ALL);
  });

  it("поиск по названию, нику хоста и коду без учёта регистра", () => {
    expect(filterRooms(ALL, "all", "rust")).toEqual([OPEN]);
    expect(filterRooms(ALL, "all", "  НИКА ")).toEqual([PASS]);
    expect(filterRooms(ALL, "all", "cccc")).toEqual([LOCKED]);
    expect(filterRooms(ALL, "open", "ника")).toEqual([]);
  });
});

describe("roomsSummary", () => {
  it("склоняет комнаты и людей", () => {
    expect(roomsSummary([OPEN])).toBe("1 комната · 3 человека");
    expect(roomsSummary(ALL)).toBe("4 комнаты · 19 человек");
    expect(roomsSummary([])).toBe("0 комнат · 0 человек");
  });
});

describe("roomRowLabel", () => {
  it("всё состояние одной фразой", () => {
    expect(roomRowLabel(PASS)).toBe("Сюда нельзя, хост Ника, 3 из 10, нужен пароль");
    expect(roomRowLabel(room({ hostName: "", locked: true }))).toBe("Вечерняя катка, 3 из 10, вход закрыт");
  });

  it("комната клуба — с названием клуба", () => {
    expect(roomRowLabel(room({ badge: { label: "Арена", color: "#ff0000" } }))).toBe(
      "Вечерняя катка, клуб Арена, хост Тёма, 3 из 10",
    );
  });
});
