// ВАЖНО: только сервер (Route Handler). Токен Upstash не должен попасть в клиент.
//
// Хранение заявок в том же Redis, что и состояние комнат и лимиты:
//   leads:v1                 — список JSON-строк, новые слева; обрезается до MAX_LEADS;
//   leads:v1:seen:<отпечаток> — «эту заявку уже брали»: защита от двойной отправки
//                              (двойной клик, повтор после обрыва), живёт сутки;
//   leads:v1:day:<дата>      — счётчик заявок за сутки: потолок против залива спамом
//                              с меняющихся адресов (иначе он вытеснил бы настоящие).
// Читает список scripts/leads-export.mjs.
import { createHash, randomBytes } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { LEADS_KEY, type Lead, type StoredLead } from "./leads";
import { getRedis, getRedisRaw } from "./redis";

/** Сколько заявок держим. Дальше самые старые выпадают: список не растёт без границ. */
export const MAX_LEADS = 5000;
/** Потолок заявок за сутки (по UTC) на весь сайт. */
export const MAX_LEADS_PER_DAY = 300;
const DEDUPE_TTL_SEC = 24 * 60 * 60;
const DAY_KEY_TTL_SEC = 3 * 24 * 60 * 60;

/**
 * Заявки с одного IP: 6 за 10 минут. В клубе гости сидят за одним внешним IP, но
 * заявку оставляют единицы; скользящее окно, как у остальных лимитов
 * (src/lib/ratelimit.ts). Лимитер ленивый: env на сборке не трогаем.
 */
let _limiter: Ratelimit | null = null;
export function leadLimit(): Ratelimit {
  return (_limiter ??= new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(6, "10 m"),
    prefix: "rl:leads",
  }));
}

/** Отпечаток заявки: контакт + вид + тариф. Сам контакт в ключ не кладём. */
export function leadFingerprint(lead: Pick<Lead, "kind" | "tier" | "contact">): string {
  const text = `${lead.kind}|${lead.tier}|${lead.contact.toLowerCase()}`;
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export type SaveResult = "saved" | "duplicate" | "daily_cap";

function dayKey(now: Date): string {
  return `${LEADS_KEY}:day:${now.toISOString().slice(0, 10)}`;
}

/**
 * Записать заявку. «duplicate» — ровно такая же уже есть за сутки: человеку
 * отвечаем «принято», как и в первый раз (повтор — не ошибка и не повод
 * гадать, дошло ли). «daily_cap» — потолок за сутки.
 * Бросает при сбое Redis: вызывающий отвечает «сервер недоступен».
 */
export async function saveLead(lead: Lead, now: Date = new Date()): Promise<SaveResult> {
  const redis = getRedisRaw();

  // Повтор не должен тратить суточный потолок, поэтому «уже брали» — первым.
  const seenKey = `${LEADS_KEY}:seen:${leadFingerprint(lead)}`;
  const first = await redis.set(seenKey, "1", { nx: true, ex: DEDUPE_TTL_SEC });
  if (first === null) return "duplicate";

  const stored: StoredLead = {
    ...lead,
    id: randomBytes(9).toString("base64url"),
    at: now.toISOString(),
  };
  try {
    const day = dayKey(now);
    const dayCount = await redis.incr(day);
    if (dayCount === 1) await redis.expire(day, DAY_KEY_TTL_SEC);
    if (dayCount > MAX_LEADS_PER_DAY) {
      await redis.del(seenKey).catch(() => {});
      return "daily_cap";
    }
    await redis.multi().lpush(LEADS_KEY, JSON.stringify(stored)).ltrim(LEADS_KEY, 0, MAX_LEADS - 1).exec();
  } catch (err) {
    // Не записали: снимаем «уже брали», иначе повтор человека молча потеряется.
    await redis.del(seenKey).catch(() => {});
    throw err;
  }
  return "saved";
}
