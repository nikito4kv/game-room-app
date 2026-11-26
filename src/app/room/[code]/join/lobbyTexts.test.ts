import { describe, expect, it } from "vitest";
import { ATTEMPTS_SHOWN_FROM, lobbyMicHint, wrongPasswordText } from "./lobbyTexts";

describe("wrongPasswordText", () => {
  const server = (n: number) => `Неверный пароль. Осталось попыток: ${n}`;

  it("много попыток — без числа", () => {
    expect(wrongPasswordText(19, server(19))).toBe("Неверный пароль");
    expect(wrongPasswordText(ATTEMPTS_SHOWN_FROM + 1, server(ATTEMPTS_SHOWN_FROM + 1))).toBe("Неверный пароль");
  });

  it("мало попыток — текст сервера с остатком", () => {
    expect(wrongPasswordText(ATTEMPTS_SHOWN_FROM, server(ATTEMPTS_SHOWN_FROM))).toBe(server(ATTEMPTS_SHOWN_FROM));
    expect(wrongPasswordText(1, server(1))).toBe(server(1));
    expect(wrongPasswordText(0, "Неверный пароль. Попытки закончились")).toBe("Неверный пароль. Попытки закончились");
  });

  it("остаток неизвестен — без числа", () => {
    expect(wrongPasswordText(null, "Неверный пароль")).toBe("Неверный пароль");
    expect(wrongPasswordText(undefined, "Неверный пароль")).toBe("Неверный пароль");
  });
});

describe("lobbyMicHint", () => {
  it("нет доступа — где разрешить", () => {
    expect(lobbyMicHint("denied")).toMatch(/значок слева от адреса/);
    expect(lobbyMicHint("denied")).toMatch(/«Повторить»/);
  });

  it("всегда напоминает, что войти можно и без микрофона", () => {
    for (const kind of ["denied", "not-found", "busy", "constraints", "unknown"] as const) {
      expect(lobbyMicHint(kind)).toMatch(/Войти и слушать можно и так\.$/);
    }
  });

  it("без «вас не слышно»: в комнату ещё не вошли", () => {
    for (const kind of ["denied", "not-found", "busy", "constraints", "unknown"] as const) {
      expect(lobbyMicHint(kind)).not.toMatch(/не слышно/);
    }
  });
});
