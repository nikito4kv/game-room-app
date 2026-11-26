import { describe, expect, it } from "vitest";
import { isGameId, parseGamePacket } from "@/lib/api/contract";
import { newGameId, parseGameCommand, pickOne, rollDie } from "./games";

describe("команды игр", () => {
  it("кубик, «Кто платит?» и «Все готовы?» — без полей", () => {
    expect(parseGameCommand({ action: "dice" })).toEqual({ action: "dice" });
    expect(parseGameCommand({ action: "pick", extra: 1 })).toEqual({ action: "pick" });
    expect(parseGameCommand({ action: "ready" })).toEqual({ action: "ready" });
  });

  it("ответ на опрос — с id и готовностью", () => {
    const id = newGameId();
    expect(parseGameCommand({ action: "ready_answer", id, ready: true })).toEqual({
      action: "ready_answer",
      id,
      ready: true,
    });
    expect(parseGameCommand({ action: "ready_answer", id, ready: "да" })).toBeNull();
    expect(parseGameCommand({ action: "ready_answer", id: "../x", ready: true })).toBeNull();
    expect(parseGameCommand({ action: "ready_answer", ready: true })).toBeNull();
  });

  it("мусор — null", () => {
    for (const action of ["DICE", "roll", "", null, undefined, 1, "toString"]) {
      expect(parseGameCommand({ action })).toBeNull();
    }
  });
});

describe("честный случай", () => {
  it("кубик: 1–6 по подставному случаю", () => {
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 5)).toBe(6);
  });

  it("настоящий кубик не выходит за 1–6 и выдаёт все грани", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const v = rollDie();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("выбор: из кандидатов; пусто — null", () => {
    expect(pickOne(["u_a", "u_b", "u_c"], () => 1)).toBe("u_b");
    expect(pickOne([], () => 0)).toBeNull();
  });

  it("id опроса — 16 символов и проходит проверку формата", () => {
    const id = newGameId();
    expect(id).toHaveLength(16);
    expect(isGameId(id)).toBe(true);
    expect(newGameId()).not.toBe(id);
  });
});

describe("пакет игры из сети", () => {
  const at = 5;
  it("верные проходят", () => {
    expect(parseGamePacket({ kind: "dice", identity: "u_a", value: 4, at })).toEqual({
      kind: "dice",
      identity: "u_a",
      value: 4,
      at,
    });
    expect(parseGamePacket({ kind: "pick", identity: "u_a", chosen: "u_b", at })).toEqual({
      kind: "pick",
      identity: "u_a",
      chosen: "u_b",
      at,
    });
    const id = newGameId();
    expect(parseGamePacket({ kind: "ready", identity: "u_a", id, at })).toEqual({
      kind: "ready",
      identity: "u_a",
      id,
      at,
    });
    expect(parseGamePacket({ kind: "ready_answer", identity: "u_b", id, ready: false, at })).toEqual({
      kind: "ready_answer",
      identity: "u_b",
      id,
      ready: false,
      at,
    });
  });

  it("кривые — null", () => {
    const id = newGameId();
    for (const raw of [
      null,
      [],
      { kind: "dice", identity: "u_a", value: 7, at },
      { kind: "dice", identity: "u_a", value: 2.5, at },
      { kind: "dice", identity: "", value: 2, at },
      { kind: "pick", identity: "u_a", chosen: "", at },
      { kind: "ready", identity: "u_a", id: "x", at },
      { kind: "ready_answer", identity: "u_a", id, ready: 1, at },
      { kind: "spin", identity: "u_a", at },
      { kind: "dice", identity: "u_a", value: 3, at: "5" },
    ]) {
      expect(parseGamePacket(raw)).toBeNull();
    }
  });
});
