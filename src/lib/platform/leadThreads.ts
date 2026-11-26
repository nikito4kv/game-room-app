// ВАЖНО: только сервер. Заявки-диалоги (А5): человек пишет на сайте, команда
// отвечает из админки, ответ виден по личной ссылке /request/<id>?t=<token>.
//
//   gr:lead:<id>           STRING JSON StoredLeadThread (токен — только sha256)
//   gr:leads               ZSET   id → updatedAt (мс): ящик админки, свежие сверху
//   gr:leads:day:<дата>    STRING счётчик новых заявок за сутки (потолок от спама)
//   gr:leads:migrated      STRING «старые leads:v1 уже перенесены»
//
// Изменения — сравнение-и-замена всей строки (CAS_STRING_LUA): ответ команды и
// сообщение человека в одну секунду не затрут друг друга.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  LEAD_PRODUCTS,
  type LeadMessage,
  type LeadProduct,
  type LeadStatus,
  type LeadThreadAdmin,
  type LeadThreadKind,
  type LeadThreadPublic,
} from "@/lib/api/platform";
import { LEADS_KEY, type StoredLead, type ValidLeadCreate } from "@/lib/leads";
import { MAX_LEADS_PER_DAY } from "@/lib/leadsStore";
import { getRedisRaw } from "@/lib/redis";
import { CAS_STRING_LUA } from "./scripts";
import { newestMembers } from "./zsetPage";

export const LEAD_STATUSES: readonly LeadStatus[] = ["new", "in_progress", "answered", "paying", "closed"];
/** Сообщений в одном диалоге: дальше — «напишите новую заявку». */
export const LEAD_MESSAGES_MAX = 200;
const INDEX = "gr:leads";
const MIGRATED_FLAG = "gr:leads:migrated";
const DAY_TTL_SEC = 3 * 24 * 60 * 60;
const leadKey = (id: string) => `gr:lead:${id}`;
const dayKey = (now: Date) => `gr:leads:day:${now.toISOString().slice(0, 10)}`;
const LEAD_ID_RE = /^[\w-]{6,40}$/;

/** Как заявка лежит в Redis: админский вид + хэш токена + «есть непрочитанный ответ». */
export type StoredLeadThread = Omit<LeadThreadAdmin, "hasUnread"> & {
  tokenHash: string;
  unread: boolean;
};

export const isLeadId = (x: unknown): x is string => typeof x === "string" && LEAD_ID_RE.test(x);
export const isLeadStatus = (x: unknown): x is LeadStatus =>
  typeof x === "string" && (LEAD_STATUSES as readonly string[]).includes(x);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Токен совпадает с сохранённым хэшем (за постоянное время). */
export function tokenMatches(token: unknown, tokenHash: string): boolean {
  if (typeof token !== "string" || !token || token.length > 200) return false;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseThread(raw: unknown): StoredLeadThread | null {
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw) as StoredLeadThread;
    return o && typeof o.id === "string" && typeof o.tokenHash === "string" && Array.isArray(o.messages)
      ? o
      : null;
  } catch {
    return null;
  }
}

export function publicView(t: StoredLeadThread): LeadThreadPublic {
  return {
    id: t.id,
    kind: t.kind,
    product: t.product,
    name: t.name,
    status: t.status,
    createdAt: t.createdAt,
    messages: t.messages,
    hasUnread: t.unread,
  };
}

export function adminView(t: StoredLeadThread): LeadThreadAdmin {
  const { tokenHash: _hash, unread, ...rest } = t;
  void _hash;
  return { ...rest, hasUnread: unread };
}

export async function loadThread(id: string): Promise<StoredLeadThread | null> {
  if (!isLeadId(id)) return null;
  return parseThread(await getRedisRaw().get(leadKey(id)));
}

/**
 * Изменить заявку функцией fn (вернула null — не менять). Сравнение-и-замена с
 * повтором. null — заявки нет.
 */
async function mutate(
  id: string,
  fn: (t: StoredLeadThread) => StoredLeadThread | null,
): Promise<StoredLeadThread | null> {
  const redis = getRedisRaw();
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await redis.get(leadKey(id));
    const current = parseThread(raw);
    if (!current) return null;
    const next = fn(current);
    if (!next) return current;
    const res = await redis.eval(CAS_STRING_LUA, [leadKey(id)], [String(raw), JSON.stringify(next)]);
    if (Number(res) === 1) {
      if (next.updatedAt !== current.updatedAt) {
        await redis.zadd(INDEX, { score: Date.parse(next.updatedAt), member: id });
      }
      return next;
    }
  }
  throw new Error("lead update conflict");
}

// ── Человек ──────────────────────────────────────────────────────────────────

/**
 * Защита от двойной отправки (двойной клик, повтор после обрыва): одинаковая
 * заявка (вид, продукт, имя, текст) принимается раз в 10 минут. Вернуть «ту же»
 * заявку повтору нельзя — её токен мы храним только хэшем, поэтому повтор
 * получает честный отказ LEAD_DUPLICATE. Сам текст в ключ не кладём — только хэш.
 */
export const LEAD_DEDUPE_SEC = 10 * 60;
const seenKey = (fp: string) => `gr:leads:seen:${fp}`;

export function leadFingerprint(lead: Pick<ValidLeadCreate, "kind" | "product" | "name" | "message">): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return sha256(`${lead.kind}|${lead.product}|${norm(lead.name)}|${norm(lead.message)}`).slice(0, 32);
}

/** true — такой заявки за 10 минут не было (и теперь отмечено). */
export async function claimLeadFingerprint(fp: string): Promise<boolean> {
  return (await getRedisRaw().set(seenKey(fp), "1", { nx: true, ex: LEAD_DEDUPE_SEC })) !== null;
}

/** Снять отметку (заявку записать не удалось — повтор человека не должен потеряться). */
export async function releaseLeadFingerprint(fp: string): Promise<void> {
  await getRedisRaw().del(seenKey(fp)).catch(() => {});
}

export type CreateLeadResult =
  | { ok: true; thread: StoredLeadThread; token: string }
  | { ok: false; reason: "daily_cap" };

/** Новая заявка. Бросает при сбое Redis (маршрут ответит «сервер недоступен»). */
export async function createLeadThread(lead: ValidLeadCreate, now: Date = new Date()): Promise<CreateLeadResult> {
  const redis = getRedisRaw();
  const day = dayKey(now);
  const count = Number(await redis.incr(day));
  if (count === 1) await redis.expire(day, DAY_TTL_SEC);
  if (count > MAX_LEADS_PER_DAY) return { ok: false, reason: "daily_cap" };

  const token = randomBytes(24).toString("base64url");
  const at = now.toISOString();
  const thread: StoredLeadThread = {
    id: randomBytes(9).toString("base64url"),
    kind: lead.kind,
    product: lead.product,
    name: lead.name,
    status: "new",
    createdAt: at,
    messages: [{ from: "user", text: lead.message, at }],
    contact: lead.contact,
    clubName: lead.clubName,
    city: lead.city,
    pcCount: lead.pcCount,
    source: lead.source,
    updatedAt: at,
    lastUserAt: at,
    lastTeamAt: null,
    migrated: false,
    tokenHash: sha256(token),
    unread: false,
  };
  const p = redis.pipeline();
  p.set(leadKey(thread.id), JSON.stringify(thread));
  p.zadd(INDEX, { score: now.getTime(), member: thread.id });
  await p.exec();
  return { ok: true, thread, token };
}

/** Заявка для её автора; «есть ответ» сбрасывается этим чтением. null — нет или чужой токен. */
export async function readThreadForUser(id: string, token: unknown): Promise<LeadThreadPublic | null> {
  const thread = await loadThread(id);
  if (!thread || !tokenMatches(token, thread.tokenHash)) return null;
  const view = publicView(thread);
  if (thread.unread) await mutate(id, (t) => (t.unread ? { ...t, unread: false } : null));
  return view;
}

export type UserReplyResult =
  | { ok: true; thread: LeadThreadPublic }
  | { ok: false; reason: "not_found" | "too_many" };

/** Сообщение автора в свой диалог. */
export async function addUserMessage(
  id: string,
  token: unknown,
  text: string,
  now: Date = new Date(),
): Promise<UserReplyResult> {
  const thread = await loadThread(id);
  if (!thread || !tokenMatches(token, thread.tokenHash)) return { ok: false, reason: "not_found" };
  if (thread.messages.length >= LEAD_MESSAGES_MAX) return { ok: false, reason: "too_many" };
  const at = now.toISOString();
  const next = await mutate(id, (t) => ({
    ...t,
    messages: [...t.messages, { from: "user", text, at } satisfies LeadMessage].slice(-LEAD_MESSAGES_MAX),
    // Человек дописал после ответа или закрытия — заявка снова требует внимания.
    status: t.status === "answered" || t.status === "closed" ? "in_progress" : t.status,
    updatedAt: at,
    lastUserAt: at,
    unread: false,
  }));
  return next ? { ok: true, thread: publicView(next) } : { ok: false, reason: "not_found" };
}

/** Пометки «есть ответ» для шапки сайта. Чужие токены и несуществующие — пропускаем. */
export async function statusBatch(
  items: { id: string; t: string }[],
): Promise<{ id: string; hasUnread: boolean; status: LeadStatus }[]> {
  const valid = items.filter((i) => isLeadId(i.id));
  if (valid.length === 0) return [];
  const raws = (await getRedisRaw().mget(...valid.map((i) => leadKey(i.id)))) as unknown[];
  return valid.flatMap((item, i) => {
    const t = parseThread(raws[i]);
    if (!t || !tokenMatches(item.t, t.tokenHash)) return [];
    return [{ id: t.id, hasUnread: t.unread, status: t.status }];
  });
}

// ── Команда (админка) ────────────────────────────────────────────────────────

export async function teamReply(id: string, text: string, now: Date = new Date()): Promise<LeadThreadAdmin | null> {
  const at = now.toISOString();
  const next = await mutate(id, (t) => ({
    ...t,
    messages: [...t.messages, { from: "team", text, at } satisfies LeadMessage].slice(-LEAD_MESSAGES_MAX),
    status: t.status === "paying" ? "paying" : "answered",
    updatedAt: at,
    lastTeamAt: at,
    unread: true,
  }));
  return next ? adminView(next) : null;
}

export async function setThreadStatus(id: string, status: LeadStatus, now: Date = new Date()): Promise<LeadThreadAdmin | null> {
  const next = await mutate(id, (t) => (t.status === status ? null : { ...t, status, updatedAt: now.toISOString() }));
  return next ? adminView(next) : null;
}

export const LEADS_PAGE = 50;

/** Ящик заявок: свежие (по последнему изменению) сверху; cursor — смещение. */
export async function listThreads(opts: { status?: LeadStatus | null; cursor?: string | null; limit?: number } = {}): Promise<{
  leads: LeadThreadAdmin[];
  nextCursor: string | null;
}> {
  const redis = getRedisRaw();
  const limit = Math.min(Math.max(1, opts.limit ?? LEADS_PAGE), 200);
  let offset = Math.max(0, Number(opts.cursor) || 0);
  const leads: LeadThreadAdmin[] = [];
  // С фильтром по статусу листаем пачками, пока не наберём страницу.
  for (let guard = 0; guard < 50 && leads.length < limit; guard++) {
    const ids = await newestMembers(INDEX, offset, limit);
    if (ids.length === 0) return { leads, nextCursor: null };
    const raws = (await redis.mget(...ids.map(leadKey))) as unknown[];
    for (let i = 0; i < ids.length; i++) {
      offset++;
      const t = parseThread(raws[i]);
      if (!t || (opts.status && t.status !== opts.status)) continue;
      leads.push(adminView(t));
      if (leads.length >= limit) break;
    }
    if (ids.length < limit && leads.length < limit) return { leads, nextCursor: null };
  }
  return { leads, nextCursor: String(offset) };
}

// ── Срок хранения ────────────────────────────────────────────────────────────

/**
 * Диалог хранится 12 месяцев с последнего изменения (сообщения, ответа, статуса);
 * дальше — удаляется. На этот срок ссылается политика конфиденциальности.
 */
export const LEAD_RETENTION_DAYS = 365;

/**
 * Удалить диалоги старше LEAD_RETENTION_DAYS. Индекс упорядочен по updatedAt —
 * смотрим только самые старые. Возвращает, сколько удалено. Зовётся при чтении
 * ящика админкой (раз в сутки достаточно — флаг-ключ на 6 часов).
 */
export async function purgeOldThreads(now: Date = new Date()): Promise<number> {
  const redis = getRedisRaw();
  const marker = await redis.set("gr:leads:purgedAt", now.toISOString(), { nx: true, ex: 6 * 60 * 60 });
  if (marker === null) return 0;
  const cutoff = now.getTime() - LEAD_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (let guard = 0; guard < 20; guard++) {
    const ids = ((await redis.zrange(INDEX, 0, 99)) as unknown[]).map(String);
    if (ids.length === 0) break;
    const raws = (await redis.mget(...ids.map(leadKey))) as unknown[];
    const doomed: string[] = [];
    let reachedFresh = false;
    ids.forEach((id, i) => {
      const t = parseThread(raws[i]);
      if (!t) return doomed.push(id);
      if (Date.parse(t.updatedAt) < cutoff) doomed.push(id);
      else reachedFresh = true;
    });
    if (doomed.length > 0) {
      const p = redis.pipeline();
      p.del(...doomed.map(leadKey));
      p.zrem(INDEX, ...doomed);
      await p.exec();
      removed += doomed.length;
    }
    if (reachedFresh || doomed.length === 0) break;
  }
  return removed;
}

// ── Перенос старых заявок leads:v1 ───────────────────────────────────────────

const OLD_PRODUCT: Record<string, LeadProduct> = { pro: "pro", club: "club", support: "support" };

/** Старая заявка → диалог. Текст сообщения собран из полей формы. */
export function threadFromLegacy(old: StoredLead): StoredLeadThread {
  const kind: LeadThreadKind = old.kind === "club_pilot" ? "club" : "pricing";
  const product: LeadProduct = OLD_PRODUCT[old.tier] ?? "other";
  const lines = [
    "Заявка из старой формы (перенесена автоматически).",
    `Что выбрали: ${LEAD_PRODUCTS[product]}.`,
    old.clubName ? `Клуб: ${old.clubName}${old.city ? `, ${old.city}` : ""}${old.pcCount ? `, ПК: ${old.pcCount}` : ""}.` : null,
    old.note ? `Заметка: ${old.note}` : null,
  ].filter(Boolean);
  return {
    id: `m_${old.id}`,
    kind,
    product,
    name: old.clubName || old.contact,
    status: "new",
    createdAt: old.at,
    messages: [{ from: "user", text: lines.join("\n"), at: old.at }],
    contact: old.contact,
    clubName: old.clubName,
    city: old.city,
    pcCount: old.pcCount,
    source: null,
    updatedAt: old.at,
    lastUserAt: old.at,
    lastTeamAt: null,
    migrated: true,
    // Ссылки на диалог у автора старой заявки нет: токен — случайный, никому не выдан.
    tokenHash: sha256(randomBytes(24).toString("base64url")),
    unread: false,
  };
}

/**
 * Перенести leads:v1 в диалоги. Идемпотентно: каждая заявка пишется с NX по своему
 * id, по окончании ставится флаг, и дальше вызов — один GET. Возвращает, сколько
 * перенесено в этот раз. Старый список не удаляется (на всякий случай).
 */
export async function migrateLegacyLeads(): Promise<number> {
  const redis = getRedisRaw();
  if (await redis.get(MIGRATED_FLAG)) return 0;
  const raw = (await redis.lrange(LEADS_KEY, 0, -1)) as unknown[];
  let moved = 0;
  for (const item of raw) {
    let old: StoredLead;
    try {
      old = JSON.parse(String(item)) as StoredLead;
    } catch {
      continue;
    }
    if (!old || typeof old.id !== "string" || typeof old.at !== "string") continue;
    const thread = threadFromLegacy(old);
    const created = await redis.set(leadKey(thread.id), JSON.stringify(thread), { nx: true });
    // В индекс — всегда, но только если заявки там ещё нет (NX: не сдвигаем уже
    // обновлённую). Так сбой между записью и индексом чинится следующим проходом:
    // флаг «перенесено» ставится только в самом конце.
    await redis.zadd(INDEX, { nx: true }, { score: Date.parse(thread.updatedAt) || 0, member: thread.id });
    if (created !== null) moved++;
  }
  await redis.set(MIGRATED_FLAG, new Date().toISOString());
  return moved;
}
