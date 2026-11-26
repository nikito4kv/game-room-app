// Ошибка вызова API на клиенте. Сервер отвечает { error: { code, message, … } }
// (ApiErrorBody из @/lib/api/contract): message — готовый русский текст для
// человека, его и показываем. Своих текстов клиент добавляет только для случаев,
// когда ответа сервера нет: сеть, обрыв, чужая страница вместо JSON.
import type { ApiErrorCode } from "@/lib/api/contract";

/** Код ошибки на клиенте: коды сервера + NETWORK (запрос не дошёл до сервера). */
export type ClientErrorCode = ApiErrorCode | "NETWORK";

const CLIENT_MESSAGES = {
  NETWORK: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз",
  SERVICE_UNAVAILABLE: "Сервер временно недоступен. Попробуйте через минуту",
  SERVER_ERROR: "На сервере что-то сломалось. Попробуйте ещё раз",
  RATE_LIMITED: "Слишком часто. Подождите немного",
} as const;

export type ApiErrorInit = {
  code: ClientErrorCode;
  message: string;
  /** HTTP-статус; 0 — ответа не было. */
  status: number;
  retryAfterSec?: number;
  attemptsLeft?: number | null;
  suggestion?: string;
  /** Ответ пришёл в формате сервера (а не прокси, не страница 404 и не обрыв сети). */
  fromServer?: boolean;
  /** Ошибки по полям формы (заявка: INVALID_LEAD) — готовый текст под полем. */
  fields?: Record<string, string>;
};

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  /** Через сколько секунд можно повторить (RATE_LIMITED, TOO_MANY_ATTEMPTS, KICKED…). */
  readonly retryAfterSec?: number;
  /** WRONG_PASSWORD: сколько попыток осталось у комнаты; null — сервер сейчас не знает. */
  readonly attemptsLeft?: number | null;
  /** NAME_TAKEN: свободный вариант ника. */
  readonly suggestion?: string;
  readonly fromServer: boolean;
  /** Ошибки по полям формы, если сервер их прислал. */
  readonly fields?: Record<string, string>;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.retryAfterSec = init.retryAfterSec;
    this.attemptsLeft = init.attemptsLeft;
    this.suggestion = init.suggestion;
    this.fromServer = init.fromServer ?? false;
    this.fields = init.fields;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Отмена запроса вызывающим (размонтировали, ушли со страницы) — не ошибка для человека. */
export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

export function networkError(): ApiError {
  return new ApiError({ code: "NETWORK", message: CLIENT_MESSAGES.NETWORK, status: 0 });
}

function positiveSeconds(x: unknown): number | undefined {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Ошибки по полям: только строки с непустым текстом; нет ни одной — undefined. */
function stringFields(x: unknown): Record<string, string> | undefined {
  if (!isRecord(x)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(x)) if (typeof v === "string" && v) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Ошибка из ответа сервера. body — разобранный JSON (или null, если пришёл не
 * JSON), retryAfter — заголовок Retry-After. Неизвестная форма (прокси отдал свою
 * страницу, старый сервер) превращается в понятный код по HTTP-статусу.
 */
export function errorFromResponse(status: number, body: unknown, retryAfter: string | null): ApiError {
  const err = isRecord(body) && isRecord(body.error) ? body.error : null;
  const headerRetry = positiveSeconds(retryAfter);
  if (err && typeof err.code === "string" && typeof err.message === "string" && err.message) {
    const attempts = err.attemptsLeft;
    return new ApiError({
      code: err.code as ApiErrorCode,
      message: err.message,
      status,
      retryAfterSec: positiveSeconds(err.retryAfterSec) ?? headerRetry,
      attemptsLeft:
        attempts === null ? null : typeof attempts === "number" && Number.isFinite(attempts) ? attempts : undefined,
      suggestion: typeof err.suggestion === "string" && err.suggestion ? err.suggestion : undefined,
      fields: stringFields(err.fields),
      fromServer: true,
    });
  }
  if (status === 429) {
    return new ApiError({
      code: "RATE_LIMITED",
      message: CLIENT_MESSAGES.RATE_LIMITED,
      status,
      retryAfterSec: headerRetry,
    });
  }
  // 502/503/504 без нашего тела — сайт перезапускается или прокси не достучался.
  const code = status >= 500 ? "SERVICE_UNAVAILABLE" : "SERVER_ERROR";
  return new ApiError({ code, message: CLIENT_MESSAGES[code], status, retryAfterSec: headerRetry });
}

/**
 * Временный сбой: повторить позже тем же запросом имеет смысл (сеть, сервер
 * перегружен или лежит, слишком часто). Остальные отказы — решение сервера.
 */
export function isTransientError(e: ApiError): boolean {
  return (
    e.code === "NETWORK" ||
    e.code === "SERVICE_UNAVAILABLE" ||
    e.code === "SERVER_ERROR" ||
    e.code === "RATE_LIMITED"
  );
}
