import { describe, expect, it } from "vitest";
import { isReactionKind, parseReactionPacket, REACTION_KINDS } from "@/lib/api/contract";
import { parseReactionKind, reactionPacket } from "./reactions";

describe("разбор реакции", () => {
  it("знает ровно четыре реакции", () => {
    expect(REACTION_KINDS).toEqual(["like", "fire", "lol", "gg"]);
    for (const k of REACTION_KINDS) expect(parseReactionKind({ kind: k })).toBe(k);
  });

  it("чужое и мусор — null", () => {
    for (const kind of ["LIKE", "heart", "", " fire", 0, null, undefined, {}, ["gg"]]) {
      expect(parseReactionKind({ kind })).toBeNull();
      expect(isReactionKind(kind)).toBe(false);
    }
    // Имя свойства из прототипа — не реакция.
    expect(isReactionKind("toString")).toBe(false);
  });

  it("пакет: identity из аргумента, время сервера", () => {
    expect(reactionPacket("u_a", "gg", 123)).toEqual({ identity: "u_a", kind: "gg", at: 123 });
  });

  it("пакет из сети: верный проходит, кривой — null", () => {
    expect(parseReactionPacket({ identity: "u_a", kind: "lol", at: 5 })).toEqual({ identity: "u_a", kind: "lol", at: 5 });
    expect(parseReactionPacket({ identity: "u_a", kind: "lol", at: 5, extra: 1 })).toEqual({
      identity: "u_a",
      kind: "lol",
      at: 5,
    });
    for (const raw of [
      null,
      "fire",
      [],
      { identity: "", kind: "lol", at: 5 },
      { identity: "u_a", kind: "boo", at: 5 },
      { identity: "u_a", kind: "lol", at: Number.NaN },
      { identity: "u_a", kind: "lol", at: "5" },
      { identity: 7, kind: "lol", at: 5 },
    ]) {
      expect(parseReactionPacket(raw)).toBeNull();
    }
  });
});
