// Лента чата на клиенте — чистые функции без React и без сети.
//
// Сообщения приходят тремя путями, и один и тот же id может прийти дважды:
//  • data-пакет LiveKit от сервера (тема CHAT_TOPIC) — всем, включая автора;
//  • ответ POST /api/chat — автору;
//  • история GET /api/chat — при входе и после переподключения.
// Поэтому лента склеивается по id. Своё сообщение показываем сразу (pending), а
// когда сервер его принял — заменяем серверной версией (её id и время).
import { CHAT_MAX_LENGTH, type ChatMessage } from "@/lib/api/contract";

/** Сообщение в ленте клиента. */
export type ChatEntry = ChatMessage & {
  /** sent — сервер принял; pending — отправляется; failed — не ушло, можно повторить. */
  state: "sent" | "pending" | "failed";
  /** Почему не ушло — готовый текст сервера. */
  error?: string;
};

/** Сколько сообщений держим в памяти (сервер хранит 100 последних). */
export const CHAT_LOG_LIMIT = 200;

const LOCAL_PREFIX = "local:";

/** Своё сообщение, ещё не подтверждённое сервером, имеет локальный id. */
export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

export function localId(seq: number): string {
  return `${LOCAL_PREFIX}${seq}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Проверяет форму сообщения из сети. Сервер чистит текст сам, здесь — только
 * защита от мусора: неверная форма или заведомо огромный текст → null.
 */
export function parseChatMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw) || !isRecord(raw.from)) return null;
  const { id, ts, text } = raw;
  const { identity, name } = raw.from;
  if (typeof id !== "string" || !id || isLocalId(id)) return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (typeof identity !== "string" || !identity || typeof name !== "string") return null;
  if (typeof text !== "string" || !text || text.length > CHAT_MAX_LENGTH * 4) return null;
  // Сообщение администрации сервиса: подпись и выделение рисует лента.
  if (raw.system === true) return { id, ts, from: { identity, name: name || identity }, text, system: true };
  return { id, ts, from: { identity, name: name || identity }, text };
}

const decoder = new TextDecoder();

/** Полезная нагрузка data-пакета чата (UTF-8 JSON ChatMessage) → сообщение или null. */
export function decodeChatPacket(payload: Uint8Array): ChatMessage | null {
  try {
    return parseChatMessage(JSON.parse(decoder.decode(payload)));
  } catch {
    return null;
  }
}

/** Новое своё сообщение до ответа сервера. */
export function pendingEntry(
  id: string,
  from: ChatMessage["from"],
  text: string,
  now: number,
): ChatEntry {
  return { id, ts: now, from, text, state: "pending" };
}

/** Разделить ленту на подтверждённые (по времени) и свои неподтверждённые (в конце). */
function split(list: readonly ChatEntry[]): { sent: ChatEntry[]; local: ChatEntry[] } {
  const sent: ChatEntry[] = [];
  const local: ChatEntry[] = [];
  for (const e of list) (isLocalId(e.id) ? local : sent).push(e);
  return { sent, local };
}

/** Вставить подтверждённое сообщение по времени (обычно — в конец). */
function insertByTime(sent: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  let i = sent.length;
  while (i > 0 && sent[i - 1].ts > entry.ts) i--;
  return [...sent.slice(0, i), entry, ...sent.slice(i)];
}

/** Подтверждённые по времени, затем свои неподтверждённые; старые сверх лимита отрезаются. */
function join(sent: ChatEntry[], local: ChatEntry[]): ChatEntry[] {
  const all = [...sent, ...local];
  return all.length > CHAT_LOG_LIMIT ? all.slice(all.length - CHAT_LOG_LIMIT) : all;
}

const asSent = (m: ChatMessage): ChatEntry => ({ ...m, state: "sent" });

/**
 * Пришло сообщение от сервера (data-пакет). Уже есть такой id — лента не
 * меняется (тот же массив). Своё сообщение может прийти раньше ответа на POST —
 * тогда оно заменяет самое раннее своё неподтверждённое с тем же текстом.
 */
export function receiveMessage(
  list: readonly ChatEntry[],
  message: ChatMessage,
  myIdentity: string,
  matchPending = true,
): readonly ChatEntry[] {
  if (list.some((e) => e.id === message.id)) return list;
  const { sent, local } = split(list);
  let rest = local;
  if (matchPending && message.from.identity === myIdentity) {
    const twin = local.findIndex((e) => e.state === "pending" && e.text === message.text);
    if (twin >= 0) rest = [...local.slice(0, twin), ...local.slice(twin + 1)];
  }
  return join(insertByTime(sent, asSent(message)), rest);
}

/** Сервер принял своё сообщение: локальная запись уступает место серверной. */
export function confirmEntry(
  list: readonly ChatEntry[],
  id: string,
  message: ChatMessage,
): readonly ChatEntry[] {
  const without = list.filter((e) => e.id !== id);
  if (without.some((e) => e.id === message.id)) return without;
  const { sent, local } = split(without);
  return join(insertByTime(sent, asSent(message)), local);
}

/** Своё сообщение не ушло: помечаем, текст ошибки — для подсказки. */
export function failEntry(list: readonly ChatEntry[], id: string, error: string): readonly ChatEntry[] {
  return list.map((e) => (e.id === id ? { ...e, state: "failed" as const, error } : e));
}

/** «Повторить»: снова отправляется. */
export function retryEntry(list: readonly ChatEntry[], id: string): readonly ChatEntry[] {
  return list.map((e) =>
    e.id === id && e.state === "failed" ? { ...e, state: "pending" as const, error: undefined } : e,
  );
}

/** Добавить своё неподтверждённое сообщение в конец. */
export function appendEntry(list: readonly ChatEntry[], entry: ChatEntry): readonly ChatEntry[] {
  const { sent, local } = split(list);
  return join(sent, [...local, entry]);
}

/**
 * История с сервера (от старых к новым) вливается в ленту: без дублей по id,
 * по времени. Свои неподтверждённые по тексту не сопоставляем: в истории может
 * лежать старое «ок», а новое «ок» ещё в пути.
 */
export function mergeHistory(
  list: readonly ChatEntry[],
  history: readonly ChatMessage[],
  myIdentity: string,
): readonly ChatEntry[] {
  let next = list;
  for (const m of history) next = receiveMessage(next, m, myIdentity, false);
  return next;
}

// ── Ссылки ───────────────────────────────────────────────────────────────────

export type TextPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

const URL_RE = /https?:\/\/[^\s<>"'«»]+/giu;
// Знаки в конце — обычно пунктуация предложения, а не часть адреса.
const TRAILING = /[.,!?;:…'"»]+$/u;

/** Срезает хвостовую пунктуацию; «)» оставляет, если в адресе есть парная «(» (Википедия). */
function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING, "");
  while (url.endsWith(")")) {
    const open = (url.match(/\(/g) ?? []).length;
    const close = (url.match(/\)/g) ?? []).length;
    if (close <= open) break;
    url = url.slice(0, -1).replace(TRAILING, "");
  }
  return url;
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Текст → куски «текст / ссылка». Ссылкой становится только http(s)-адрес;
 * всё остальное (javascript:, data:, просто слова) остаётся текстом. Рисуется
 * через React (без innerHTML), поэтому разметка в тексте безопасна.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = parts[parts.length - 1];
    if (prev?.kind === "text") prev.text += t;
    else parts.push({ kind: "text", text: t });
  };
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimUrl(match[0]);
    const href = safeHref(url);
    push(text.slice(last, start));
    if (href) parts.push({ kind: "link", text: url, href });
    else push(url);
    last = start + url.length;
  }
  push(text.slice(last));
  return parts;
}

// ── Группы и заголовок ───────────────────────────────────────────────────────

export type ChatGroup = {
  /** Ключ для React — id первого сообщения группы. */
  key: string;
  from: ChatMessage["from"];
  mine: boolean;
  /** Сообщения администрации сервиса (выделенный стиль «Администрация»). */
  system: boolean;
  entries: ChatEntry[];
};

/** Пауза, после которой сообщения того же автора начинают новую группу. */
export const GROUP_GAP_MS = 5 * 60_000;

/**
 * Сообщения подряд от одного автора (без долгих пауз) — одной группой.
 * breakBefore — id, с которого начать новую группу (над ним разделитель «Новые»).
 */
export function groupEntries(
  list: readonly ChatEntry[],
  myIdentity: string,
  breakBefore: string | null = null,
  gapMs = GROUP_GAP_MS,
): ChatGroup[] {
  const groups: ChatGroup[] = [];
  for (const e of list) {
    const g = groups[groups.length - 1];
    const prev = g?.entries[g.entries.length - 1];
    const sameRun =
      g && prev && g.from.identity === e.from.identity && g.system === !!e.system && e.ts - prev.ts <= gapMs;
    if (sameRun && e.id !== breakBefore) {
      g.entries.push(e);
    } else {
      groups.push({
        key: e.id,
        from: e.from,
        mine: !e.system && e.from.identity === myIdentity,
        system: !!e.system,
        entries: [e],
      });
    }
  }
  return groups;
}

export const APP_NAME = "Game Room";

/** Заголовок вкладки в комнате: «(3) Вечерняя катка · Game Room». */
export function roomTabTitle(title: string, unread: number): string {
  const base = `${title} · ${APP_NAME}`;
  if (unread <= 0) return base;
  return `(${unread > 99 ? "99+" : unread}) ${base}`;
}

/** Время сообщения «21:07». */
export function formatChatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
