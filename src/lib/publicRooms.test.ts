import { describe, it, expect } from "vitest";
import {
  sortPublicRooms,
  toPublicRoomSummaries,
  type PublicRoomCandidate,
} from "@/lib/publicRooms";

function cand(
  name: string,
  numParticipants: number,
  createdAt: number,
  opts: { locked?: boolean } = {},
): PublicRoomCandidate {
  return {
    room: { name, numParticipants, maxParticipants: 10 },
    meta: {
      title: `T-${name}`,
      hostName: `Хост ${name}`,
      createdAt,
      locked: opts.locked ?? false,
    },
  };
}

describe("sortPublicRooms", () => {
  it("сортирует по участникам убыв., при равенстве — по createdAt убыв.", () => {
    const sorted = sortPublicRooms([cand("A", 2, 100), cand("B", 5, 50), cand("C", 2, 200)]);
    expect(sorted.map((x) => x.room.name)).toEqual(["B", "C", "A"]);
  });
  it("не мутирует входной массив", () => {
    const input = [cand("A", 1, 1), cand("B", 2, 2)];
    const copy = [...input];
    sortPublicRooms(input);
    expect(input).toEqual(copy);
  });
});

describe("toPublicRoomSummaries", () => {
  const c = cand("ROOM1", 3, 1000, { locked: true });

  it("auth с паролем → hasPassword true; ник хоста — в hostName", () => {
    const map = new Map([["ROOM1", { passwordHash: "salt:hash" }]]);
    expect(toPublicRoomSummaries([c], map)).toEqual([
      {
        code: "ROOM1",
        title: "T-ROOM1",
        hostName: "Хост ROOM1",
        numParticipants: 3,
        maxParticipants: 10,
        createdAt: 1000,
        locked: true,
        hasPassword: true,
      },
    ]);
  });

  it("auth без пароля → hasPassword false", () => {
    const map = new Map([["ROOM1", { passwordHash: null }]]);
    expect(toPublicRoomSummaries([c], map)[0].hasPassword).toBe(false);
  });

  it("auth === null (нет состояния в Redis) → комната исключена", () => {
    const map = new Map<string, { passwordHash: string | null } | null>([["ROOM1", null]]);
    expect(toPublicRoomSummaries([c], map)).toEqual([]);
  });

  it("auth неизвестен (сбой чтения) → консервативно hasPassword true", () => {
    expect(toPublicRoomSummaries([c], new Map())[0].hasPassword).toBe(true);
  });
});
