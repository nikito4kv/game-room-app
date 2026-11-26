import { describe, expect, it } from "vitest";
import { classifyJoinFailure, endScreenView, formatCountdown } from "./joinScreens";
import type { Refusal } from "./session";

const err = (code: Refusal["code"], extra: Partial<Refusal> = {}): Refusal => ({
  code,
  message: `текст ${code}`,
  ...extra,
});

describe("classifyJoinFailure", () => {
  it("ник и пароль — подсказка у поля", () => {
    expect(classifyJoinFailure(err("NAME_TAKEN", { suggestion: "Вася 2" }), 0)).toEqual({
      type: "form",
      problem: { field: "name", message: "текст NAME_TAKEN", suggestion: "Вася 2" },
    });
    expect(classifyJoinFailure(err("INVALID_NAME"), 0)).toMatchObject({ problem: { field: "name" } });
    expect(classifyJoinFailure(err("WRONG_PASSWORD", { attemptsLeft: 2 }), 0)).toMatchObject({
      problem: { field: "password", message: "текст WRONG_PASSWORD" },
    });
  });

  it("слишком часто — кнопка ждёт", () => {
    expect(classifyJoinFailure(err("TOO_MANY_ATTEMPTS", { retryAfterSec: 30 }), 1000)).toEqual({
      type: "form",
      problem: { field: "password", message: "текст TOO_MANY_ATTEMPTS" },
      waitUntil: 31_000,
    });
    expect(classifyJoinFailure(err("RATE_LIMITED", { retryAfterSec: 5 }), 0)).toMatchObject({
      problem: { field: "form" },
      waitUntil: 5000,
    });
  });

  it("решения сервера — экраны", () => {
    expect(classifyJoinFailure(err("ROOM_NOT_FOUND"), 0)).toEqual({ type: "screen", screen: { kind: "notFound" } });
    expect(classifyJoinFailure(err("KICKED", { retryAfterSec: 120 }), 1000)).toEqual({
      type: "screen",
      screen: { kind: "kicked", until: 121_000 },
    });
    expect(classifyJoinFailure(err("BANNED"), 0)).toMatchObject({ screen: { kind: "banned" } });
    expect(classifyJoinFailure(err("ROOM_FULL"), 0)).toMatchObject({ screen: { kind: "full" } });
    expect(classifyJoinFailure(err("ROOM_LOCKED"), 0)).toMatchObject({ screen: { kind: "locked" } });
    expect(classifyJoinFailure(err("SEAT_TAKEN"), 0)).toMatchObject({ screen: { kind: "seat" } });
    expect(classifyJoinFailure(err("CLIENT_OUTDATED"), 0)).toMatchObject({ screen: { kind: "outdated" } });
  });

  it("решения администрации — свои экраны с текстом сервера", () => {
    expect(classifyJoinFailure(err("ROOM_CLOSED"), 0)).toEqual({
      type: "screen",
      screen: { kind: "adminClosed", message: "текст ROOM_CLOSED" },
    });
    expect(classifyJoinFailure(err("BLOCKED"), 0)).toEqual({
      type: "screen",
      screen: { kind: "blocked", message: "текст BLOCKED" },
    });
    expect(classifyJoinFailure(err("MAINTENANCE"), 0)).toEqual({
      type: "screen",
      screen: { kind: "maintenance", message: "текст MAINTENANCE" },
    });
  });

  it("сеть и сбои сервера — в форме, «Войти» и есть повтор", () => {
    expect(classifyJoinFailure(err("NETWORK"), 0)).toMatchObject({ type: "form", problem: { field: "form" } });
    expect(classifyJoinFailure(err("SERVICE_UNAVAILABLE"), 0)).toMatchObject({ type: "form" });
  });
});

describe("endScreenView", () => {
  it("причина удаления — свой экран", () => {
    expect(endScreenView({ kind: "removed", reason: "kick", until: 5 })).toEqual({ kind: "kicked", until: 5 });
    expect(endScreenView({ kind: "removed", reason: "ban", until: null })).toEqual({ kind: "banned" });
    expect(endScreenView({ kind: "removed", reason: "locked", until: null })).toMatchObject({ kind: "locked" });
    expect(endScreenView({ kind: "removed", reason: null, until: null })).toEqual({ kind: "removed" });
  });

  it("удаление администрацией — отдельно от хоста", () => {
    expect(endScreenView({ kind: "removed", reason: "admin_kick", until: 9 })).toEqual({
      kind: "adminRemoved",
      until: 9,
      ban: false,
    });
    expect(endScreenView({ kind: "removed", reason: "admin_ban", until: null })).toEqual({
      kind: "adminRemoved",
      until: null,
      ban: true,
    });
    expect(endScreenView({ kind: "removed", reason: "admin_close", until: null })).toEqual({
      kind: "adminClosed",
      message: null,
    });
    // Комнату удалили, а причина не дошла: при входе заново сервер ответит ROOM_CLOSED.
    expect(endScreenView({ kind: "refused", error: err("ROOM_CLOSED") })).toMatchObject({ kind: "adminClosed" });
  });

  it("отказ при входе заново", () => {
    expect(endScreenView({ kind: "refused", error: err("ROOM_FULL") })).toMatchObject({ kind: "full" });
    expect(endScreenView({ kind: "refused", error: err("UNAUTHORIZED") })).toEqual({
      kind: "error",
      message: "текст UNAUTHORIZED",
    });
  });

  it("остальные — как есть", () => {
    expect(endScreenView({ kind: "lost" })).toEqual({ kind: "lost" });
    expect(endScreenView({ kind: "closed" })).toEqual({ kind: "closed" });
    expect(endScreenView({ kind: "left" })).toEqual({ kind: "left" });
  });
});

describe("formatCountdown", () => {
  it("минуты и секунды", () => {
    expect(formatCountdown(299.2)).toBe("5:00");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(59.1)).toBe("1:00");
    expect(formatCountdown(42)).toBe("42 с");
    expect(formatCountdown(-3)).toBe("0 с");
  });
});
