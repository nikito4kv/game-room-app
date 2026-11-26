// Ответы-отказы API. Один словарь кодов и русских текстов на весь сервер, один
// формат: { error: { code, message, … } } (ApiErrorBody в контракте).
import { NextResponse } from "next/server";
import { TwirpError } from "livekit-server-sdk";
import type {
  ApiError,
  ApiErrorBody,
  ApiErrorCode,
  RetryableErrorCode,
} from "@/lib/api/contract";
import {
  AVATAR_HEIGHT,
  AVATAR_MAX_BYTES,
  AVATAR_WIDTH,
  MAX_PARTICIPANTS,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  TITLE_MAX_LENGTH,
} from "@/lib/api/contract";

type SimpleCode = Exclude<ApiErrorCode, "WRONG_PASSWORD" | "NAME_TAKEN" | RetryableErrorCode>;

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  CLIENT_OUTDATED: 426,
  INVALID_NAME: 400,
  INVALID_TITLE: 400,
  INVALID_PASSWORD: 400,
  ROOM_NOT_FOUND: 404,
  PASSWORD_REQUIRED: 401,
  WRONG_PASSWORD: 401,
  TOO_MANY_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  SEAT_TAKEN: 409,
  NAME_TAKEN: 409,
  ROOM_FULL: 409,
  ROOM_LOCKED: 403,
  BANNED: 403,
  KICKED: 403,
  UNAUTHORIZED: 401,
  NOT_IN_ROOM: 403,
  NOT_HOST: 403,
  NOT_OWNER: 403,
  TARGET_NOT_FOUND: 404,
  TARGET_IS_OWNER: 403,
  TARGET_IS_SELF: 400,
  HOST_PRESENT: 409,
  HOST_HANDOVER_PENDING: 409,
  CHAT_DISABLED: 403,
  CHAT_HOST_ONLY: 403,
  CHAT_MUTED: 403,
  MESSAGE_EMPTY: 400,
  MESSAGE_TOO_LONG: 400,
  BLOCKED: 403,
  ROOM_CLOSED: 403,
  MAINTENANCE: 503,
  INVALID_KEY: 400,
  FEATURE_DISABLED: 503,
  LEAD_NOT_FOUND: 404,
  LEAD_DUPLICATE: 409,
  AVATAR_INVALID: 400,
  AVATAR_BLOCKED: 403,
  AVATAR_NOT_FOUND: 404,
  AVATAR_LIMIT: 429,
  SOUND_INVALID: 400,
  SOUND_LIMIT: 409,
  SOUND_NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
  SERVER_ERROR: 500,
};

const MESSAGES: Record<SimpleCode, string> = {
  BAD_REQUEST: "Некорректный запрос",
  CLIENT_OUTDATED: "Приложение обновилось — обновите страницу",
  INVALID_NAME: `Ник должен быть от ${NAME_MIN_LENGTH} до ${NAME_MAX_LENGTH} символов`,
  INVALID_TITLE: `Название комнаты — от 1 до ${TITLE_MAX_LENGTH} символов`,
  INVALID_PASSWORD: `Пароль — от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов`,
  ROOM_NOT_FOUND: "Комната не найдена. Проверьте код или создайте новую",
  PASSWORD_REQUIRED: "Комната защищена паролем",
  SEAT_TAKEN:
    "В этой комнате ваше место занято другим устройством. Зайдите с того браузера, где входили раньше",
  ROOM_FULL: `Комната заполнена: в ней уже ${MAX_PARTICIPANTS} человек`,
  ROOM_LOCKED: "Хост закрыл комнату для новых участников",
  BANNED: "Вас забанили в этой комнате",
  UNAUTHORIZED: "Не удалось подтвердить, что это вы. Перезайдите в комнату",
  NOT_IN_ROOM: "Вы сейчас не в комнате",
  NOT_HOST: "Это может сделать только хост",
  NOT_OWNER: "Вернуть права может только создатель комнаты",
  TARGET_NOT_FOUND: "Участник не найден в комнате",
  TARGET_IS_OWNER: "Создателя комнаты нельзя удалить, забанить или заглушить",
  TARGET_IS_SELF: "Нельзя применить это к себе",
  HOST_PRESENT: "Хост в комнате — права уже заняты",
  CHAT_DISABLED: "Хост выключил чат",
  CHAT_HOST_ONLY: "Сейчас писать в чат может только хост",
  CHAT_MUTED: "Хост запретил вам писать в чат",
  MESSAGE_EMPTY: "Пустое сообщение",
  MESSAGE_TOO_LONG: "Сообщение слишком длинное",
  BLOCKED: "Вход с этого адреса или устройства закрыт администрацией сервиса",
  ROOM_CLOSED: "Комнату закрыла администрация сервиса",
  MAINTENANCE: "Идут технические работы. Попробуйте чуть позже",
  INVALID_KEY: "Ключ не подошёл. Проверьте, что он введён без ошибок",
  FEATURE_DISABLED: "Эта функция временно выключена. Попробуйте позже",
  LEAD_NOT_FOUND: "Заявка не найдена. Проверьте ссылку",
  LEAD_DUPLICATE:
    "Такая заявка уже отправлена несколько минут назад. Ссылка на неё — в «Моих заявках» на этом устройстве",
  AVATAR_INVALID: `Рисунок не подошёл: нужна картинка PNG ${AVATAR_WIDTH}×${AVATAR_HEIGHT} не больше ${AVATAR_MAX_BYTES / 1024} КБ`,
  AVATAR_BLOCKED: "Этот рисунок скрыла администрация. Нарисуйте другой",
  AVATAR_NOT_FOUND: "Рисунок не найден",
  AVATAR_LIMIT: "Новые рисунки на сегодня закончились. Пока ваш Румик будет без рисунка",
  SOUND_INVALID: "Звук не подошёл: нужен короткий аудиофайл (mp3, ogg, wav) до 300 КБ и название",
  SOUND_LIMIT: "В комнате уже 12 своих звуков. Уберите ненужный, чтобы добавить новый",
  SOUND_NOT_FOUND: "Звук не найден. Возможно, его уже убрали",
  SERVICE_UNAVAILABLE: "Сервер временно недоступен. Попробуйте через минуту",
  SERVER_ERROR: "На сервере что-то сломалось. Попробуйте ещё раз",
};

/** AVATAR_BLOCKED, когда администрация скрыла все рисунки участника в комнате (а не один). */
export const AVATAR_BANNED_MESSAGE = "Администрация скрыла ваши рисунки в этой комнате";

/** «через 25 с» / «через 4 мин» — без склонений, чтобы не путаться в падежах. */
export function formatWait(sec: number): string {
  const s = Math.max(1, Math.ceil(sec));
  return s < 60 ? `${s} с` : `${Math.ceil(s / 60)} мин`;
}

/** Отказ без подробностей; message — свой текст вместо стандартного. */
export function apiError(code: SimpleCode, message?: string): ApiError {
  return { code, message: message ?? MESSAGES[code] };
}

/** Отказ «повторите позже» с retryAfterSec (целые секунды, не меньше 1). */
export function retryError(code: RetryableErrorCode, retryAfterSec: number): ApiError {
  const sec = Math.max(1, Math.ceil(retryAfterSec));
  const wait = formatWait(sec);
  const message = {
    TOO_MANY_ATTEMPTS: `Слишком много неверных паролей. Попробуйте через ${wait}`,
    RATE_LIMITED: `Слишком часто. Подождите ${wait}`,
    KICKED: `Хост выгнал вас из комнаты. Вернуться можно через ${wait}`,
    HOST_HANDOVER_PENDING: `Хост вышел недавно. Его место можно будет занять через ${wait}`,
  }[code];
  return { code, message, retryAfterSec: sec };
}

/** attemptsLeft: null — счётчик попыток сейчас недоступен (Redis лимитов не ответил). */
export function wrongPassword(attemptsLeft: number | null): ApiError {
  if (attemptsLeft === null) {
    return { code: "WRONG_PASSWORD", message: "Неверный пароль", attemptsLeft: null };
  }
  const left = Math.max(0, Math.floor(attemptsLeft));
  return {
    code: "WRONG_PASSWORD",
    message:
      left > 0
        ? `Неверный пароль. Осталось попыток: ${left}`
        : "Неверный пароль. Попытки закончились — следующую можно будет сделать позже",
    attemptsLeft: left,
  };
}

/** Почему ник не годится (см. checkNickname). */
export function invalidName(reason: "empty" | "too_short" | "too_long"): ApiError {
  const message = {
    empty: "Введите ник",
    too_short: `Ник слишком короткий — нужно хотя бы ${NAME_MIN_LENGTH} символа`,
    too_long: `Ник слишком длинный — не больше ${NAME_MAX_LENGTH} символов`,
  }[reason];
  return apiError("INVALID_NAME", message);
}

const IO_ERROR_NAMES = new Set(["UpstashError", "UpstashJSONParseError", "AbortError", "TimeoutError"]);

/**
 * Отказ по пойманному исключению: сбой Redis, LiveKit или сети — «сервер временно
 * недоступен» (повторить скоро), всё остальное — «ошибка сервера».
 */
export function failureFrom(err: unknown): ApiError {
  return isServiceFailure(err) ? apiError("SERVICE_UNAVAILABLE") : apiError("SERVER_ERROR");
}

function isServiceFailure(err: unknown): boolean {
  if (err instanceof TwirpError) return true;
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  if (typeof name === "string" && IO_ERROR_NAMES.has(name)) return true;
  // fetch в Node падает TypeError("fetch failed") с причиной ECONNREFUSED и т.п.
  return err instanceof TypeError && /fetch failed/i.test(err.message);
}

export function nameTaken(name: string, suggestion: string): ApiError {
  return {
    code: "NAME_TAKEN",
    message: `Ник «${name}» уже занят в комнате. Например, «${suggestion}» свободен`,
    suggestion,
  };
}

/** «Комната заполнена» с фактическим лимитом этой комнаты. */
export function roomFull(maxParticipants: number): ApiError {
  return apiError("ROOM_FULL", `Комната заполнена: в ней уже ${maxParticipants} человек`);
}

/** HTTP-статус отказа. */
export function statusOf(error: ApiError): number {
  return STATUS[error.code];
}

/** Ответ-отказ: тело ApiErrorBody, свой HTTP-статус и Retry-After, если есть срок. */
export function errorResponse(error: ApiError): NextResponse {
  const headers: Record<string, string> = {};
  if ("retryAfterSec" in error) headers["Retry-After"] = String(error.retryAfterSec);
  const body: ApiErrorBody = { error };
  return NextResponse.json(body, { status: statusOf(error), headers });
}
