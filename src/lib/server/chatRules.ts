// Правила чата — чистые функции: проверка текста и политики комнаты.
import { CHAT_MAX_LENGTH, type ApiError, type ChatPolicy } from "@/lib/api/contract";
import { apiError } from "./errors";

// Управляющие символы, КРОМЕ перевода строки, и символы направления текста
// (RLO/LRO и изоляторы): ими переворачивают текст и подделывают чужие сообщения.
// Соединитель эмодзи (ZWJ) оставляем — без него семейные эмодзи рассыпаются.
const STRIP = /[^\P{Cc}\n]|[؜‎‏‪-‮⁦-⁩]/gu;
// Сырой ввод заметно длиннее лимита не разбираем вовсе.
const RAW_LIMIT = CHAT_MAX_LENGTH * 4;

export type ChatTextCheck = { ok: true; text: string } | { ok: false; error: ApiError };

/**
 * Чистит и проверяет текст: \r\n → \n, без управляющих символов, 3+ перевода
 * строки → 2, без пробелов по краям; длина — не больше CHAT_MAX_LENGTH кодовых точек.
 */
export function validateChatText(raw: unknown): ChatTextCheck {
  if (typeof raw !== "string") {
    return { ok: false, error: apiError("BAD_REQUEST", "Нет текста сообщения") };
  }
  if (raw.length > RAW_LIMIT) return { ok: false, error: apiError("MESSAGE_TOO_LONG") };
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(STRIP, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return { ok: false, error: apiError("MESSAGE_EMPTY") };
  if ([...text].length > CHAT_MAX_LENGTH) {
    return {
      ok: false,
      error: apiError("MESSAGE_TOO_LONG", `Сообщение длиннее ${CHAT_MAX_LENGTH} символов`),
    };
  }
  return { ok: true, text };
}

/** Может ли участник писать при текущей политике. null — может. */
export function checkChatPolicy(
  policy: ChatPolicy,
  sender: { isHost: boolean; chatMuted: boolean },
): ApiError | null {
  if (policy === "off") return apiError("CHAT_DISABLED");
  if (policy === "host" && !sender.isHost) return apiError("CHAT_HOST_ONLY");
  if (sender.chatMuted && !sender.isHost) return apiError("CHAT_MUTED");
  return null;
}
