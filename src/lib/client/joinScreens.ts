// Что показать человеку, когда войти не вышло: подсказку у поля формы лобби или
// отдельный экран с действием («Попробовать снова», «На главную»). Чистые
// функции: тексты причин — от сервера (error.message), здесь только выбор места.
import type { EndScreen, Refusal } from "./session";

/** Экран вместо формы или комнаты. */
export type ScreenView =
  /** Комнаты с таким кодом нет (лобби). */
  | { kind: "notFound" }
  /** Комната была, но закрылась (вход заново после обрыва). */
  | { kind: "closed" }
  /** Выгнали: until — когда можно вернуться (мс эпохи); null — неизвестно. */
  | { kind: "kicked"; until: number | null }
  | { kind: "banned" }
  /** Удалили, причина не дошла. */
  | { kind: "removed" }
  /** Удалила администрация сервиса: until — когда можно вернуться (мс эпохи), ban — насовсем. */
  | { kind: "adminRemoved"; until: number | null; ban: boolean }
  /** Комнату закрыла администрация; message — объяснение сервера, если было. */
  | { kind: "adminClosed"; message: string | null }
  /** Адрес или устройство заблокированы администрацией. */
  | { kind: "blocked"; message: string }
  /** Режим обслуживания: вход временно закрыт. */
  | { kind: "maintenance"; message: string }
  | { kind: "locked"; message: string }
  | { kind: "full" }
  | { kind: "seat"; message: string }
  | { kind: "outdated" }
  | { kind: "duplicate" }
  | { kind: "lost" }
  | { kind: "voice" }
  | { kind: "error"; message: string }
  /** Вышли сами — «Вернуться» без лобби. */
  | { kind: "left" };

/** Подсказка у поля формы лобби. */
export type FormProblem = {
  field: "name" | "password" | "form";
  message: string;
  /** NAME_TAKEN: свободный ник — кнопкой «Взять». */
  suggestion?: string;
};

export type JoinFailure =
  | { type: "form"; problem: FormProblem; /** Кнопку «Войти» блокируем до этого момента. */ waitUntil?: number }
  | { type: "screen"; screen: ScreenView };

/** Отказ POST /api/token в лобби → подсказка у поля или экран. */
export function classifyJoinFailure(error: Refusal, now: number): JoinFailure {
  const wait = error.retryAfterSec ? now + error.retryAfterSec * 1000 : undefined;
  switch (error.code) {
    case "INVALID_NAME":
      return { type: "form", problem: { field: "name", message: error.message } };
    case "NAME_TAKEN":
      return { type: "form", problem: { field: "name", message: error.message, suggestion: error.suggestion } };
    case "PASSWORD_REQUIRED":
    case "WRONG_PASSWORD":
      return { type: "form", problem: { field: "password", message: error.message } };
    case "TOO_MANY_ATTEMPTS":
      return { type: "form", problem: { field: "password", message: error.message }, waitUntil: wait };
    case "RATE_LIMITED":
      return { type: "form", problem: { field: "form", message: error.message }, waitUntil: wait };
    case "ROOM_NOT_FOUND":
      return { type: "screen", screen: { kind: "notFound" } };
    case "KICKED":
      return { type: "screen", screen: { kind: "kicked", until: wait ?? null } };
    case "BANNED":
      return { type: "screen", screen: { kind: "banned" } };
    case "ROOM_LOCKED":
      return { type: "screen", screen: { kind: "locked", message: error.message } };
    case "ROOM_FULL":
      return { type: "screen", screen: { kind: "full" } };
    case "SEAT_TAKEN":
      return { type: "screen", screen: { kind: "seat", message: error.message } };
    case "CLIENT_OUTDATED":
      return { type: "screen", screen: { kind: "outdated" } };
    case "ROOM_CLOSED":
      return { type: "screen", screen: { kind: "adminClosed", message: error.message || null } };
    case "BLOCKED":
      return { type: "screen", screen: { kind: "blocked", message: error.message } };
    case "MAINTENANCE":
      return { type: "screen", screen: { kind: "maintenance", message: error.message } };
    default:
      // Сеть, сервер, кривой запрос — остаёмся в форме: «Войти» и есть повтор.
      return { type: "form", problem: { field: "form", message: error.message } };
  }
}

/** Финальный экран сессии (после входа) → что нарисовать. */
export function endScreenView(screen: EndScreen): ScreenView {
  switch (screen.kind) {
    case "removed":
      if (screen.reason === "kick") return { kind: "kicked", until: screen.until };
      if (screen.reason === "ban") return { kind: "banned" };
      if (screen.reason === "locked") {
        return { kind: "locked", message: "Хост закрыл комнату для новых участников" };
      }
      if (screen.reason === "admin_kick") return { kind: "adminRemoved", until: screen.until, ban: false };
      if (screen.reason === "admin_ban") return { kind: "adminRemoved", until: null, ban: true };
      if (screen.reason === "admin_close") return { kind: "adminClosed", message: null };
      return { kind: "removed" };
    case "duplicate":
    case "lost":
    case "voice":
    case "closed":
    case "left":
      return { kind: screen.kind };
    case "refused": {
      const failure = classifyJoinFailure(screen.error, 0);
      return failure.type === "screen" ? failure.screen : { kind: "error", message: screen.error.message };
    }
  }
}

/** Обратный отсчёт: «4:59» от минуты и больше, «25 с» — меньше минуты. */
export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s} с`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
