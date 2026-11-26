// ВАЖНО: только сервер. Сколько места занимают рисунки Румика (R4) — для карточки
// «Здоровья» в админке (GET /api/internal/avatars).
//
// Как считаем. Рисунки живут 30 дней после последнего использования и пропадают
// сами (TTL Redis), поэтому счётчик «при записи» со временем врал бы: истечение
// ключа его не уменьшит, а ловить истечения пришлось бы подпиской на уведомления
// Redis — лишний процесс и настройка сервера. Значит, считаем по факту: SCAN по
// шаблону gr:avatar* (а не KEYS: тот блокирует Redis на всё время прохода) с
// потолком шагов, а размер — STRLEN пачками. Это сотни запросов при сотнях тысяч
// ключей, поэтому результат живёт в памяти минуту и одновременные запросы ждут
// один проход. Суточный бюджет — один GET, он всегда свежий.
import { AVATAR_TTL_DAYS } from "@/lib/api/contract";
import type { AvatarStorageResponse, RuntimeConfig } from "@/lib/api/platform";
import { getRedisRaw } from "@/lib/redis";
import { AVATAR_KEY_PREFIX, avatarDayBudgetBytes, avatarDayKey } from "@/lib/server/avatar";

/** Одним проходом видны и рисунки, и скрытые, и служебные ключи (их пропускаем). */
const SCAN_MATCH = "gr:avatar*";
const SCAN_COUNT = 1000;
/** Потолок шагов SCAN: ≈ 300 тыс. ключей базы; дальше — «нижняя оценка» (partial). */
export const SCAN_STEPS_MAX = 300;
const STRLEN_BATCH = 500;
export const AVATAR_STATS_CACHE_MS = 60_000;

export type AvatarCount = Pick<AvatarStorageResponse, "count" | "bytes" | "hidden" | "hiddenBytes" | "partial"> & {
  countedAt: number;
};

/** Сумма длин строк по ключам (пачками через pipeline). */
async function totalLength(keys: string[]): Promise<number> {
  let sum = 0;
  for (let i = 0; i < keys.length; i += STRLEN_BATCH) {
    const p = getRedisRaw().pipeline();
    for (const k of keys.slice(i, i + STRLEN_BATCH)) p.strlen(k);
    const res = (await p.exec()) as unknown[];
    for (const n of res) sum += Number(n) || 0;
  }
  return sum;
}

/** Пересчитать хранилище проходом SCAN. Бросает при сбое Redis. */
export async function countAvatarStorage(now: number = Date.now(), stepsMax = SCAN_STEPS_MAX): Promise<AvatarCount> {
  const redis = getRedisRaw();
  const data: string[] = [];
  const hidden: string[] = [];
  let cursor = "0";
  let partial = true;
  for (let i = 0; i < stepsMax; i++) {
    const [next, batch] = (await redis.scan(cursor, { match: SCAN_MATCH, count: SCAN_COUNT })) as [
      string | number,
      unknown[],
    ];
    for (const raw of batch) {
      const key = String(raw);
      if (key.startsWith(AVATAR_KEY_PREFIX.data)) data.push(key);
      else if (key.startsWith(AVATAR_KEY_PREFIX.hidden)) hidden.push(key);
    }
    cursor = String(next);
    if (cursor === "0") {
      partial = false;
      break;
    }
  }
  // SCAN может вернуть ключ дважды (рехеширование) — считаем каждый раз один.
  const uniq = (xs: string[]) => [...new Set(xs)];
  const dataKeys = uniq(data);
  const hiddenKeys = uniq(hidden);
  return {
    count: dataKeys.length,
    bytes: await totalLength(dataKeys),
    hidden: hiddenKeys.length,
    hiddenBytes: await totalLength(hiddenKeys),
    partial,
    countedAt: now,
  };
}

let cached: AvatarCount | null = null;
let inflight: Promise<AvatarCount> | null = null;

/** Сбросить кэш (тесты). */
export function resetAvatarStatsCache(): void {
  cached = null;
  inflight = null;
}

/** Подсчёт с кэшем на минуту; одновременные запросы ждут один проход. */
export async function cachedAvatarCount(now: number = Date.now()): Promise<AvatarCount> {
  if (cached && now - cached.countedAt < AVATAR_STATS_CACHE_MS) return cached;
  inflight ??= countAvatarStorage(now)
    .then((c) => (cached = c))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Полный ответ внутреннего API: подсчёт (из кэша) + свежий бюджет дня + лимиты из настроек. */
export async function avatarStorage(cfg: RuntimeConfig, now: Date = new Date()): Promise<AvatarStorageResponse> {
  const [c, used] = await Promise.all([cachedAvatarCount(now.getTime()), getRedisRaw().get(avatarDayKey(now))]);
  return {
    at: now.toISOString(),
    countedAt: new Date(c.countedAt).toISOString(),
    count: c.count,
    bytes: c.bytes,
    hidden: c.hidden,
    hiddenBytes: c.hiddenBytes,
    partial: c.partial,
    today: {
      date: now.toISOString().slice(0, 10),
      usedBytes: Number(used) || 0,
      budgetBytes: avatarDayBudgetBytes(cfg),
    },
    newPerRoom: cfg.limits.avatarNewPerRoom,
    ttlDays: AVATAR_TTL_DAYS,
  };
}
