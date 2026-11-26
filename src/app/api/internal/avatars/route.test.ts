// Хранилище рисунков для «Здоровья» админки (GET /api/internal/avatars) и лимиты
// рисунков из настроек продукта (суточный бюджет, новые на комнату).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis, applyTestEnv } from "@/lib/server/testFakes";

const h = vi.hoisted(() => ({ redis: null as unknown }));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));

import { DEFAULT_RUNTIME_CONFIG, type AvatarStorageResponse, type PlatformError } from "@/lib/api/platform";
import { cachedAvatarCount, countAvatarStorage, resetAvatarStatsCache } from "@/lib/platform/avatarStorage";
import { CONFIG_KEY, loadRuntimeConfig, peekRuntimeConfig, resetConfigCache } from "@/lib/platform/runtimeConfig";
import { avatarNewRoomLimit } from "@/lib/ratelimit";
import { consumeAvatarBudget } from "@/lib/server/avatar";
import { GET } from "./route";

const TOKEN = "i".repeat(40);

/**
 * FakeRedis + STRLEN, INCRBY и SCAN по страницам (по page ключей за шаг, как
 * настоящий курсор), чтобы проверить потолок шагов. Считает шаги SCAN.
 */
class StorageRedis extends FakeRedis {
  page = 2;
  scans = 0;
  async strlen(key: string) {
    const v = await this.get(key);
    return typeof v === "string" ? v.length : 0;
  }
  async incrby(key: string, by: number) {
    const next = Number((await this.get(key)) ?? 0) + Number(by);
    await this.set(key, String(next));
    return next;
  }
  async scan(cursor: string | number, opts: { match?: string; count?: number } = {}) {
    this.scans++;
    const prefix = (opts.match ?? "*").replace(/\*$/, "");
    const all = this.keys().filter((k) => k.startsWith(prefix)).sort();
    const from = Number(cursor);
    const next = from + this.page;
    return [next >= all.length ? "0" : String(next), all.slice(from, next)];
  }
}

let redis: StorageRedis;
const get = (token = TOKEN) =>
  GET(new Request("http://app.test/api/internal/avatars", { headers: { "x-internal-token": token } }), undefined);
const setLimits = async (patch: Partial<typeof DEFAULT_RUNTIME_CONFIG.limits>) => {
  await redis.set(CONFIG_KEY, JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, limits: { ...DEFAULT_RUNTIME_CONFIG.limits, ...patch } }));
  resetConfigCache();
};

beforeAll(() => {
  applyTestEnv();
  process.env.INTERNAL_API_TOKEN = TOKEN;
});

beforeEach(async () => {
  vi.useRealTimers();
  redis = new StorageRedis();
  h.redis = redis;
  resetConfigCache();
  resetAvatarStatsCache();
  await redis.set("gr:avatar:aaaaaaaaaaaaaaaa", "x".repeat(400));
  await redis.set("gr:avatar:bbbbbbbbbbbbbbbb", "y".repeat(100));
  await redis.set("gr:avatarhidden:cccccccccccccccc", "z".repeat(50));
  // Служебные ключи рисунков не считаются рисунками.
  await redis.set("gr:avatarblock:cccccccccccccccc", "{}");
  await redis.set("gr:avatarban:ABCDEF:u_x", "{}");
  await redis.set("gr:room:ABCDEF", "{}");
});

describe("GET /api/internal/avatars", () => {
  it("сколько рисунков и места, скрытые отдельно, бюджет дня и потолки из настроек", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    await redis.set("gr:avatarday:2026-10-06", String(3 * 1024 * 1024));
    await setLimits({ avatarDayBudgetMb: 4, avatarNewPerRoom: 25 });
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as AvatarStorageResponse;
    expect(body).toMatchObject({
      count: 2,
      bytes: 500,
      hidden: 1,
      hiddenBytes: 50,
      partial: false,
      today: { date: "2026-10-06", usedBytes: 3 * 1024 * 1024, budgetBytes: 4 * 1024 * 1024 },
      newPerRoom: 25,
      ttlDays: 30,
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("без токена — 401; подсчёт кэшируется на минуту, бюджет дня — всегда свежий", async () => {
    expect((await get("wrong-token")).status).toBe(401);
    const first = (await (await get()).json()) as AvatarStorageResponse;
    const scans = redis.scans;
    await redis.set("gr:avatar:dddddddddddddddd", "q".repeat(10));
    await redis.set(`gr:avatarday:${new Date().toISOString().slice(0, 10)}`, "777");
    const second = (await (await get()).json()) as AvatarStorageResponse;
    expect(redis.scans).toBe(scans);
    expect(second.count).toBe(first.count);
    expect(second.today.usedBytes).toBe(777);
    // Через минуту — пересчёт.
    const later = await cachedAvatarCount(Date.now() + 61_000);
    expect(later.count).toBe(3);
  });

  it("SCAN с потолком шагов: не дошли до конца — partial и нижняя оценка", async () => {
    redis.page = 1;
    const full = await countAvatarStorage(Date.now(), 100);
    expect(full).toMatchObject({ count: 2, hidden: 1, partial: false });
    const cut = await countAvatarStorage(Date.now(), 2);
    expect(cut.partial).toBe(true);
    expect(cut.count).toBeLessThanOrEqual(2);
  });

  it("Redis упал — 503 с понятным кодом", async () => {
    redis.scan = async () => {
      throw new Error("down");
    };
    const res = await get();
    expect(res.status).toBe(503);
    expect(((await res.json()) as PlatformError).error).toBe("unavailable");
  });
});

describe("лимиты рисунков из настроек продукта", () => {
  it("суточный бюджет берётся из limits.avatarDayBudgetMb", async () => {
    await setLimits({ avatarDayBudgetMb: 1 });
    const now = new Date("2026-10-06T12:00:00Z");
    expect(await consumeAvatarBudget(1024 * 1024 - 10, now)).toBe(true);
    expect(await consumeAvatarBudget(20, now)).toBe(false);
    await setLimits({ avatarDayBudgetMb: 2 });
    expect(await consumeAvatarBudget(20, now)).toBe(true);
  });

  it("порог новых рисунков на комнату — из прочитанного конфига; на порог свой лимитер", async () => {
    expect(peekRuntimeConfig().limits.avatarNewPerRoom).toBe(40);
    const byDefault = avatarNewRoomLimit();
    expect(avatarNewRoomLimit(40)).toBe(byDefault);
    await setLimits({ avatarNewPerRoom: 7 });
    await loadRuntimeConfig();
    expect(avatarNewRoomLimit()).toBe(avatarNewRoomLimit(7));
    expect(avatarNewRoomLimit()).not.toBe(byDefault);
  });
});
