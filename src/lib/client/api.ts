// Клиент API Game Room, протокол v2. Все запросы и ответы — на типах из
// @/lib/api/contract (главный документ протокола). Любой отказ — ApiError
// (./errors): code для логики, message — готовый текст для человека.
import {
  LEAD_TOKEN_HEADER,
  PROTOCOL_VERSION,
  isSoundId,
  type AvatarRequest,
  type AvatarResponse,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatPostResponse,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type ModerateResponse,
  type ModerationCommand,
  type PreviewResponse,
  type PublicRoomSummary,
  type PublicRoomsResponse,
  type PublicStatus,
  type PublicVoiceState,
  type SoundRemoveRequest,
  type SoundRemoveResponse,
  type SoundsListResponse,
  type SoundUploadRequest,
  type SoundUploadResponse,
  type StatusRequest,
  type StatusResponse,
  type TokenRequest,
  type TokenResponse,
  type VoiceRequest,
  type VoiceResponse,
} from "@/lib/api/contract";
import type {
  LeadCreateRequest,
  LeadCreateResponse,
  LeadReplyRequest,
  LeadStatusBatchRequest,
  LeadStatusBatchResponse,
  LeadThreadPublic,
  PublicConfigResponse,
  ReportRequest,
  ReportResponse,
} from "@/lib/api/platform";
import { RULES_VERSION } from "@/lib/api/platform";
import { getEnterSound } from "@/lib/clientStorage";
import { getOrCreateVid } from "./beacon";
import { parseChatMessage } from "./chat";
import { errorFromResponse, networkError } from "./errors";

/** Дольше ждать ответа нет смысла: в клубе лучше честно сказать «нет связи». */
const TIMEOUT_MS = 20_000;

type CallInit = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  /** Отмена вызывающим (размонтирование): промис отклоняется AbortError. */
  signal?: AbortSignal;
};

async function call<T>(path: string, init: CallInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const outer = init.signal;
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method: init.method ?? "GET",
        headers: {
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch (err) {
      // Отменил вызывающий — пробрасываем как есть (AbortError), это не сбой сети.
      if (outer?.aborted) throw err;
      throw networkError();
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw errorFromResponse(res.status, body, res.headers.get("Retry-After"));
    // 200 без JSON — ответил не наш сервер (портал Wi-Fi, заглушка прокси).
    if (body === null) throw errorFromResponse(502, null, null);
    return body as T;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

/** Создать комнату. hostKey выдаётся один раз — сохраните его (stashHostKey). */
export function createRoom(req: CreateRoomRequest, signal?: AbortSignal): Promise<CreateRoomResponse> {
  // vid — случайный номер браузера для аналитики (А4), без связи с человеком.
  const vid = getOrCreateVid();
  return call<CreateRoomResponse>("/api/rooms", { method: "POST", body: { ...req, ...(vid ? { vid } : {}) }, signal });
}

/** Витрина публичных комнат. */
export async function listPublicRooms(signal?: AbortSignal): Promise<PublicRoomSummary[]> {
  const res = await call<PublicRoomsResponse>("/api/rooms", { signal });
  return Array.isArray(res.rooms) ? res.rooms : [];
}

/** Превью комнаты для лобби: название, замок, пароль, кто внутри (без имён при пароле). */
export function getRoomPreview(code: string, signal?: AbortSignal): Promise<PreviewResponse> {
  return call<PreviewResponse>(`/api/rooms/${encodeURIComponent(code)}`, { signal });
}

/** Войти в комнату: токен LiveKit + описание комнаты. */
export function requestToken(
  req: Omit<TokenRequest, "v">,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  // Входя, человек принимает правила (строка под кнопкой «Войти»): их версию сервер пишет в событие входа.
  const vid = getOrCreateVid();
  // Свой звук входа (настройки → «Звуки»): сервер возьмёт его, если соундборд включён для комнаты.
  const enterSound = getEnterSound();
  const body: TokenRequest = {
    v: PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    ...(vid ? { vid } : {}),
    ...(isSoundId(enterSound) ? { enterSound } : {}),
    ...req,
  };
  return call<TokenResponse>("/api/token", { method: "POST", body, signal });
}

/** Действие хоста, владельца или «занять место хоста». */
export function moderate(
  code: string,
  token: string,
  command: ModerationCommand,
  signal?: AbortSignal,
): Promise<ModerateResponse> {
  return call<ModerateResponse>("/api/moderate", {
    method: "POST",
    body: { code, token, ...command },
    signal,
  });
}

/** Отправить сообщение в чат. Ответ — то же сообщение, что разошлётся всем (склейка по id). */
export async function sendChatMessage(code: string, token: string, text: string): Promise<ChatMessage> {
  const res = await call<ChatPostResponse>("/api/chat", {
    method: "POST",
    body: { code, token, text },
  });
  const message = parseChatMessage(res.message);
  if (!message) throw errorFromResponse(502, null, null);
  return message;
}

/**
 * Своё «звук выкл» и рация — сервер запишет их в атрибуты участника, и их увидят
 * другие. Звать, когда уже подключились к комнате.
 */
/** Свои звуки комнаты (контракт — раздел «Звуки комнаты»): список, добавить, убрать. */
export function getRoomSounds(code: string, token: string, signal?: AbortSignal): Promise<SoundsListResponse> {
  return call<SoundsListResponse>(`/api/sounds?code=${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
}
export function uploadRoomSound(code: string, token: string, name: string, data: string): Promise<SoundUploadResponse> {
  const body: SoundUploadRequest = { code, token, name, data };
  return call<SoundUploadResponse>("/api/sounds", { method: "POST", body });
}
export function removeRoomSound(code: string, token: string, id: string): Promise<SoundRemoveResponse> {
  const body: SoundRemoveRequest = { code, token, remove: id };
  return call<SoundRemoveResponse>("/api/sounds", { method: "POST", body });
}

/** Свой статус («в игре», «отошёл», «слушаю») — в атрибуты участника для других. */
export function sendStatus(code: string, token: string, status: PublicStatus, signal?: AbortSignal): Promise<StatusResponse> {
  const body: StatusRequest = { code, token, kind: status.kind, text: status.text };
  return call<StatusResponse>("/api/status", { method: "POST", body, signal });
}

export function sendVoiceState(
  code: string,
  token: string,
  state: PublicVoiceState,
  signal?: AbortSignal,
): Promise<VoiceResponse> {
  const body: VoiceRequest = { code, token, deafened: state.deafened, ptt: state.ptt };
  return call<VoiceResponse>("/api/voice", { method: "POST", body, signal });
}

/**
 * Свой рисунок Румика для других в комнате: png — base64 PNG 286×240 (без
 * «data:…»), null — снять. Звать, когда уже подключились к комнате.
 */
export function sendAvatar(code: string, token: string, png: string | null, signal?: AbortSignal): Promise<AvatarResponse> {
  const body: AvatarRequest = { code, token, png };
  return call<AvatarResponse>("/api/avatar", { method: "POST", body, signal });
}

/** История чата (от старых к новым). Звать, когда уже подключились к комнате. */
export async function fetchChatHistory(
  code: string,
  token: string,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const res = await call<ChatHistoryResponse>(`/api/chat?code=${encodeURIComponent(code)}`, {
    // Токен — в заголовке, а не в адресе: адреса оседают в логах прокси.
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!Array.isArray(res.messages)) return [];
  return res.messages.flatMap((m) => {
    const parsed = parseChatMessage(m);
    return parsed ? [parsed] : [];
  });
}

// ── Платформа (админка): настройки, заявки, жалобы — src/lib/api/platform.ts ──

/** Настройки сайта для браузера: флаги, объявления, обслуживание, потолок показа. */
export function getPublicConfig(room?: string, signal?: AbortSignal): Promise<PublicConfigResponse> {
  const q = room ? `?room=${encodeURIComponent(room)}` : "";
  return call<PublicConfigResponse>(`/api/config${q}`, { signal });
}

/**
 * Новая заявка. website — ловушка для ботов (человек поле не видит). Ответ —
 * личная ссылка: токен показывается один раз, его надо сохранить (myLeads).
 */
export function createLead(
  req: LeadCreateRequest & { website?: string },
  signal?: AbortSignal,
): Promise<LeadCreateResponse> {
  return call<LeadCreateResponse>("/api/leads", { method: "POST", body: req, signal });
}

/** Переписка по заявке (видна только с токеном). Заодно сбрасывает «есть ответ». */
export function getLeadThread(id: string, t: string, signal?: AbortSignal): Promise<LeadThreadPublic> {
  // Токен — в заголовке, не в адресе: адреса попадают в логи и отчёты об ошибках.
  return call<LeadThreadPublic>(`/api/leads/${encodeURIComponent(id)}`, {
    signal,
    headers: { [LEAD_TOKEN_HEADER]: t },
  });
}

/** Дописать в заявку. Ответ — обновлённая переписка. */
export function replyToLead(id: string, t: string, text: string, signal?: AbortSignal): Promise<LeadThreadPublic> {
  const body: LeadReplyRequest = { t, text };
  return call<LeadThreadPublic>(`/api/leads/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body,
    signal,
    headers: { [LEAD_TOKEN_HEADER]: t },
  });
}

/** Есть ли ответы по моим заявкам — для метки в шапке сайта. */
export function getLeadsStatus(
  items: LeadStatusBatchRequest["items"],
  signal?: AbortSignal,
): Promise<LeadStatusBatchResponse> {
  const body: LeadStatusBatchRequest = { items };
  return call<LeadStatusBatchResponse>("/api/leads/status", { method: "POST", body, signal });
}

/** Пожаловаться на человека или на комнату (токен участника — доказательство, что вы в комнате). */
export function sendReport(req: ReportRequest, signal?: AbortSignal): Promise<ReportResponse> {
  return call<ReportResponse>("/api/report", { method: "POST", body: req, signal });
}
