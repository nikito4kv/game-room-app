import { describe, expect, it } from "vitest";
import { ApiError, errorFromResponse, isAbortError, isTransientError, networkError } from "./errors";

describe("errorFromResponse", () => {
  it("берёт код, текст и подробности из ответа сервера", () => {
    const e = errorFromResponse(
      409,
      { error: { code: "NAME_TAKEN", message: "Ник занят", suggestion: "Вася 2" } },
      null,
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: "NAME_TAKEN", message: "Ник занят", suggestion: "Вася 2", status: 409, fromServer: true });
  });

  it("ошибки по полям формы: только непустые строки", () => {
    const e = errorFromResponse(
      400,
      { error: { code: "INVALID_LEAD", message: "Проверьте поля", fields: { name: "Нужно имя", pcCount: 3, note: "" } } },
      null,
    );
    expect(e.fields).toEqual({ name: "Нужно имя" });
    expect(errorFromResponse(400, { error: { code: "BAD_REQUEST", message: "x" } }, null).fields).toBeUndefined();
  });

  it("attemptsLeft: число и null различаются", () => {
    const some = errorFromResponse(401, { error: { code: "WRONG_PASSWORD", message: "м", attemptsLeft: 3 } }, null);
    const unknown = errorFromResponse(401, { error: { code: "WRONG_PASSWORD", message: "м", attemptsLeft: null } }, null);
    expect(some.attemptsLeft).toBe(3);
    expect(unknown.attemptsLeft).toBeNull();
  });

  it("retryAfterSec из тела или из заголовка", () => {
    expect(
      errorFromResponse(403, { error: { code: "KICKED", message: "м", retryAfterSec: 120 } }, null).retryAfterSec,
    ).toBe(120);
    expect(errorFromResponse(429, { error: { code: "RATE_LIMITED", message: "м" } }, "7").retryAfterSec).toBe(7);
  });

  it("чужой ответ без нашего тела — понятный код по статусу", () => {
    expect(errorFromResponse(502, null, null)).toMatchObject({ code: "SERVICE_UNAVAILABLE", fromServer: false });
    expect(errorFromResponse(404, "<html>", null)).toMatchObject({ code: "SERVER_ERROR" });
    expect(errorFromResponse(429, null, "12")).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 12 });
    // Старый формат { error: "текст" } — тоже не наш.
    expect(errorFromResponse(400, { error: "текст" }, null).fromServer).toBe(false);
  });
});

describe("классы ошибок", () => {
  it("сеть и перегрузка — временные, отказы — нет", () => {
    expect(isTransientError(networkError())).toBe(true);
    expect(isTransientError(errorFromResponse(503, null, null))).toBe(true);
    expect(isTransientError(errorFromResponse(403, { error: { code: "BANNED", message: "м" } }, null))).toBe(false);
  });

  it("отмену распознаём по имени", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(networkError())).toBe(false);
  });
});
