import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "@/lib/server/testFakes";

const h = vi.hoisted(() => ({ redis: null as unknown }));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));

import {
  AVATAR_LIMIT_BOUNDS,
  DEFAULT_RUNTIME_CONFIG,
  FEATURE_FLAGS,
  RULES_VERSION,
  isRoomlessFlag,
  type FeatureFlagName,
  type RuntimeConfig,
} from "@/lib/api/platform";
import {
  CONFIG_KEY,
  ROOMLESS_FLAGS,
  activeAnnouncements,
  flagBucket,
  isFlagOn,
  loadRuntimeConfig,
  parseStoredConfig,
  resetConfigCache,
  toPublicConfig,
  validateConfigInput,
  writeRuntimeConfig,
} from "./runtimeConfig";

const base = (): Omit<RuntimeConfig, "rev" | "updatedAt"> => {
  const { rev: _r, updatedAt: _u, ...rest } = structuredClone(DEFAULT_RUNTIME_CONFIG);
  void _r;
  void _u;
  return rest;
};
const cfgWith = (patch: Partial<RuntimeConfig>): RuntimeConfig => ({ ...structuredClone(DEFAULT_RUNTIME_CONFIG), ...patch });

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  h.redis = redis;
  resetConfigCache();
});

describe("флаги", () => {
  it("корзина устойчива, 0–99 и не зависит от регистра", () => {
    expect(flagBucket("ABC123")).toBe(flagBucket("abc123"));
    const buckets = ["AAAA", "BBBB", "K7QMP4", "ZZZZZZ"].map(flagBucket);
    for (const b of buckets) expect(b).toBeGreaterThanOrEqual(0);
    for (const b of buckets) expect(b).toBeLessThan(100);
  });

  it("процент: доля комнат близка к заданной", () => {
    const cfg = cfgWith({ flags: { chat: { mode: "percent", percent: 10 } } });
    let on = 0;
    for (let i = 0; i < 2000; i++) if (isFlagOn(cfg, "chat", `R${i.toString(36).toUpperCase()}X`)) on++;
    expect(on / 2000).toBeGreaterThan(0.06);
    expect(on / 2000).toBeLessThan(0.14);
  });

  it("без правила — значение по умолчанию; процент и список без комнаты — выключено", () => {
    expect(isFlagOn(DEFAULT_RUNTIME_CONFIG, "chat")).toBe(true);
    expect(isFlagOn(cfgWith({ flags: { chat: { mode: "percent", percent: 100 } } }), "chat")).toBe(false);
    expect(isFlagOn(cfgWith({ flags: { chat: { mode: "percent", percent: 100 } } }), "chat", "ABCD")).toBe(true);
    expect(isFlagOn(cfgWith({ flags: { chat: { mode: "percent", percent: 0 } } }), "chat", "ABCD")).toBe(false);
    const list = cfgWith({ flags: { chat: { mode: "list", rooms: ["ABCD"] } } });
    expect(isFlagOn(list, "chat", "abcd")).toBe(true);
    expect(isFlagOn(list, "chat", "EFGH")).toBe(false);
    expect(isFlagOn(list, "chat")).toBe(false);
    expect(isFlagOn(cfgWith({ flags: { chat: { mode: "off" } } }), "chat", "ABCD")).toBe(false);
  });
});

describe("объявления и публичный вид", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const cfg = cfgWith({
    announcements: [
      { id: "a", text: "сайт", level: "info", where: "site", startsAt: null, endsAt: null },
      { id: "b", text: "везде", level: "warning", where: "both", startsAt: "2026-10-06T11:00:00Z", endsAt: "2026-10-06T13:00:00Z" },
      { id: "c", text: "будущее", level: "info", where: "both", startsAt: "2026-10-07T00:00:00Z", endsAt: null },
      { id: "d", text: "прошло", level: "info", where: "room", startsAt: null, endsAt: "2026-10-06T11:59:59Z" },
    ],
  });

  it("только активные и для своего места", () => {
    expect(activeAnnouncements(cfg, "site", now).map((a) => a.id)).toEqual(["a", "b"]);
    expect(activeAnnouncements(cfg, "room", now).map((a) => a.id)).toEqual(["b"]);
  });

  it("toPublicConfig: флаги для комнаты, версия правил, без внутренних полей", () => {
    const pub = toPublicConfig(cfg, "ABCD", now);
    expect(pub.flags.chat).toBe(true);
    expect(pub.rulesVersion).toBe(RULES_VERSION);
    expect(pub.announcements).toEqual([{ id: "b", text: "везде", level: "warning" }]);
    expect(pub).not.toHaveProperty("rev");
  });
});

describe("проверка входящего конфига", () => {
  it("умолчания проходят", () => {
    expect(validateConfigInput(base()).ok).toBe(true);
  });

  it("границы чисел и тексты", () => {
    const bad = (mut: (c: ReturnType<typeof base>) => void) => {
      const c = base();
      mut(c);
      return validateConfigInput(c).ok;
    };
    expect(bad((c) => (c.limits.maxParticipants = 1))).toBe(false);
    expect(bad((c) => (c.limits.maxParticipants = 26))).toBe(false);
    expect(bad((c) => (c.limits.maxParticipants = 25))).toBe(true);
    expect(bad((c) => (c.limits.maxRooms = -1))).toBe(false);
    expect(bad((c) => (c.limits.maxRooms = 1.5))).toBe(false);
    expect(bad((c) => ((c.limits as { maxScreenQuality: string }).maxScreenQuality = "4k"))).toBe(false);
    expect(bad((c) => (c.maintenance.message = "я".repeat(301)))).toBe(false);
    expect(bad((c) => (c.maintenance.message = "я".repeat(300)))).toBe(true);
    expect(
      bad((c) => {
        c.announcements = Array.from({ length: 11 }, (_, i) => ({
          id: `a${i}`, text: "т", level: "info" as const, where: "site" as const, startsAt: null, endsAt: null,
        }));
      }),
    ).toBe(false);
    expect(bad((c) => (c.flags = { chat: { mode: "percent", percent: 101 } }))).toBe(false);
    expect(bad((c) => (c.flags = { nope: { mode: "on" } } as never))).toBe(false);
    expect(bad((c) => (c.flags = { chat: { mode: "list", rooms: ["bad code!"] } }))).toBe(false);
    // Флаги без комнаты — только «вкл/выкл».
    expect(bad((c) => (c.flags = { create_room: { mode: "percent", percent: 10 } }))).toBe(false);
    expect(bad((c) => (c.flags = { leads: { mode: "list", rooms: ["ABCD"] } }))).toBe(false);
    expect(bad((c) => (c.flags = { access_keys: { mode: "off" } }))).toBe(true);
    const msg = validateConfigInput({ ...base(), flags: { leads: { mode: "percent", percent: 5 } } });
    expect(!msg.ok && msg.message).toContain("только включить или выключить");
  });

  it("флаги «на весь сайт» — по признаку roomless из общего контракта (его же читает админка)", () => {
    expect([...ROOMLESS_FLAGS].sort()).toEqual([
      "access_keys",
      "create_room",
      "leads",
      "pwa",
      "rumik_decor",
      "rumik_editor",
    ]);
    for (const name of Object.keys(FEATURE_FLAGS) as FeatureFlagName[]) {
      const r = validateConfigInput({ ...base(), flags: { [name]: { mode: "percent", percent: 10 } } });
      expect(r.ok).toBe(!isRoomlessFlag(name));
    }
    expect(validateConfigInput({ ...base(), flags: { rumik_editor: { mode: "list", rooms: ["ABCD"] } } }).ok).toBe(false);
    expect(validateConfigInput({ ...base(), flags: { rumik_share: { mode: "list", rooms: ["ABCD"] } } }).ok).toBe(true);
  });

  it("лимиты рисунков: границы из контракта; нет поля (админка старше) — умолчание, а не отказ", () => {
    const withLimits = (patch: Record<string, unknown>) =>
      validateConfigInput({ ...base(), limits: { ...base().limits, ...patch } as RuntimeConfig["limits"] });
    const b = AVATAR_LIMIT_BOUNDS;
    expect(withLimits({ avatarDayBudgetMb: b.avatarDayBudgetMb.max, avatarNewPerRoom: b.avatarNewPerRoom.min }).ok).toBe(true);
    expect(withLimits({ avatarDayBudgetMb: b.avatarDayBudgetMb.max + 1 }).ok).toBe(false);
    expect(withLimits({ avatarDayBudgetMb: 0 }).ok).toBe(false);
    expect(withLimits({ avatarNewPerRoom: 2.5 }).ok).toBe(false);
    expect(withLimits({ avatarNewPerRoom: b.avatarNewPerRoom.max + 1 }).ok).toBe(false);
    const { avatarDayBudgetMb: _a, avatarNewPerRoom: _b, ...old } = base().limits;
    void _a;
    void _b;
    const r = validateConfigInput({ ...base(), limits: { ...old, maxParticipants: 6 } as RuntimeConfig["limits"] });
    expect(r.ok && r.value.limits).toEqual({ ...DEFAULT_RUNTIME_CONFIG.limits, maxParticipants: 6 });
    // Сохранённый до этой правки конфиг: остальные лимиты не сбрасываются.
    const stored = parseStoredConfig(JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, limits: { ...old, maxRooms: 7 } }));
    expect(stored.limits).toEqual({ ...DEFAULT_RUNTIME_CONFIG.limits, maxRooms: 7 });
    expect(DEFAULT_RUNTIME_CONFIG.limits).toMatchObject({ avatarDayBudgetMb: 8, avatarNewPerRoom: 40 });
  });

  it("список кодов приводится к верхнему регистру без повторов", () => {
    const c = base();
    c.flags = { chat: { mode: "list", rooms: ["abcd", "ABCD", "efgh"] } };
    const r = validateConfigInput(c);
    expect(r.ok && r.value.flags.chat).toEqual({ mode: "list", rooms: ["ABCD", "EFGH"] });
  });

  it("битый сохранённый конфиг — умолчания по частям", () => {
    expect(parseStoredConfig("{oops")).toEqual(DEFAULT_RUNTIME_CONFIG);
    const parsed = parseStoredConfig(
      JSON.stringify({ flags: { chat: { mode: "off" } }, limits: { maxParticipants: 999 }, rev: 4 }),
    );
    expect(parsed.flags.chat).toEqual({ mode: "off" });
    expect(parsed.limits).toEqual(DEFAULT_RUNTIME_CONFIG.limits);
    expect(parsed.rev).toBe(4);
  });
});

describe("чтение и запись", () => {
  it("пустой Redis — умолчания; запись с верной ревизией поднимает rev", async () => {
    expect(await loadRuntimeConfig()).toEqual(DEFAULT_RUNTIME_CONFIG);
    const next = base();
    next.limits.maxParticipants = 6;
    const res = await writeRuntimeConfig(next, 0, new Date("2026-10-06T00:00:00Z"));
    expect(res.ok && res.config.rev).toBe(1);
    expect(JSON.parse(String(await redis.get(CONFIG_KEY))).limits.maxParticipants).toBe(6);
    expect((await loadRuntimeConfig()).limits.maxParticipants).toBe(6);
  });

  it("устаревшая ревизия — конфликт с текущим конфигом", async () => {
    await writeRuntimeConfig(base(), 0);
    const res = await writeRuntimeConfig(base(), 0);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.current.rev).toBe(1);
  });

  it("Redis упал — последний известный, а без него умолчания (без исключения)", async () => {
    h.redis = { get: async () => Promise.reject(new Error("down")) };
    resetConfigCache();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadRuntimeConfig()).toEqual(DEFAULT_RUNTIME_CONFIG);
    errSpy.mockRestore();
  });

  it("кэш ≈10 с: изменение в Redis видно не сразу", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
    await loadRuntimeConfig();
    await redis.set(CONFIG_KEY, JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, flags: { chat: { mode: "off" } } }));
    expect((await loadRuntimeConfig()).flags.chat).toBeUndefined();
    vi.setSystemTime(new Date("2026-10-06T00:00:11Z"));
    expect((await loadRuntimeConfig()).flags.chat).toEqual({ mode: "off" });
    vi.useRealTimers();
  });
});
