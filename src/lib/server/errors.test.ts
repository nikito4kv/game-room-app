import { describe, expect, it } from "vitest";
import { TwirpError } from "livekit-server-sdk";
import {
  apiError,
  errorResponse,
  failureFrom,
  formatWait,
  nameTaken,
  retryError,
  statusOf,
  wrongPassword,
} from "./errors";

describe("errorResponse", () => {
  it("формат { error: { code, message, … } } и статус по коду", async () => {
    const res = errorResponse(nameTaken("Вася", "Вася 2"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "NAME_TAKEN", message: expect.stringContaining("Вася 2"), suggestion: "Вася 2" },
    });
  });

  it("отказы «повторите позже» несут Retry-After", () => {
    const res = errorResponse(retryError("KICKED", 299.2));
    expect(res.status).toBe(403);
    expect(res.headers.get("Retry-After")).toBe("300");
  });

  it("401 — только пароль и проверка токена", () => {
    expect(statusOf(apiError("PASSWORD_REQUIRED"))).toBe(401);
    expect(statusOf(wrongPassword(3))).toBe(401);
    expect(statusOf(apiError("UNAUTHORIZED"))).toBe(401);
    expect(statusOf(apiError("ROOM_LOCKED"))).toBe(403);
    expect(statusOf(apiError("CLIENT_OUTDATED"))).toBe(426);
    expect(statusOf(apiError("SERVICE_UNAVAILABLE"))).toBe(503);
  });
});

describe("тексты", () => {
  it("неверный пароль сообщает остаток попыток", () => {
    expect(wrongPassword(3)).toMatchObject({ attemptsLeft: 3, message: expect.stringContaining("3") });
    expect(wrongPassword(null)).toMatchObject({ attemptsLeft: null, message: "Неверный пароль" });
  });

  it("ожидание: секунды до минуты, дальше минуты", () => {
    expect(formatWait(25)).toBe("25 с");
    expect(formatWait(300)).toBe("5 мин");
    expect(formatWait(0)).toBe("1 с");
    expect(retryError("KICKED", 300).message).toContain("5 мин");
  });
});

describe("failureFrom", () => {
  it("сбой LiveKit, Redis или сети — SERVICE_UNAVAILABLE", () => {
    expect(failureFrom(new TwirpError("x", "y", 503)).code).toBe("SERVICE_UNAVAILABLE");
    const upstash = Object.assign(new Error("x"), { name: "UpstashError" });
    expect(failureFrom(upstash).code).toBe("SERVICE_UNAVAILABLE");
    expect(failureFrom(new TypeError("fetch failed")).code).toBe("SERVICE_UNAVAILABLE");
    expect(failureFrom(new DOMException("t", "TimeoutError")).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("остальное — SERVER_ERROR", () => {
    expect(failureFrom(new Error("баг")).code).toBe("SERVER_ERROR");
    expect(failureFrom("строка").code).toBe("SERVER_ERROR");
  });
});
