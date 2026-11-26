// ВАЖНО: только сервер. Настройки продукта (А3): флаги, лимиты, объявления, режим
// обслуживания. Лежат JSON-строкой в Redis gr:cfg; пишет их только админка через
// PUT /api/internal/config, сайт читает с кэшем ≈10 с.
//
// Redis недоступен — работаем на последнем прочитанном конфиге, а если его не было —
// на DEFAULT_RUNTIME_CONFIG (= поведение сайта до админки). Падать из-за настроек
// сайт не должен.
import {
  AVATAR_LIMIT_BOUNDS,
  DEFAULT_RUNTIME_CONFIG,
  FEATURE_FLAGS,
  MAX_PARTICIPANTS_HARD,
  RULES_VERSION,
  isRoomlessFlag,
  type Announcement,
  type FeatureFlagName,
  type FlagRule,
  type Maintenance,
  type PublicConfigResponse,
  type RuntimeConfig,
  type RuntimeLimits,
  type ScreenQualityCap,
} from "@/lib/api/platform";
import { getRedisRaw } from "@/lib/redis";
import { CAS_STRING_LUA } from "./scripts";

export const CONFIG_KEY = "gr:cfg";
export const CONFIG_CACHE_MS = 10_000;
/** После сбоя чтения повторяем не сразу, а через пару секунд. */
const CONFIG_RETRY_MS = 2_000;

export const ANNOUNCEMENTS_MAX = 10;
export const TEXT_MAX = 300;
const ROOMS_IN_LIST_MAX = 200;
const SCREEN_CAPS: readonly ScreenQualityCap[] = ["720p", "1080p", "1440p"];
const FLAG_NAMES = Object.keys(FEATURE_FLAGS) as FeatureFlagName[];
const ROOM_CODE_RE = /^[A-Z0-9]{4,12}$/;

/**
 * Флаги, которые проверяются без комнаты (создание комнаты, заявки, ключи на
 * создании, украшения сайта): «процент комнат» и «список комнат» для них
 * бессмысленны — только включено или выключено. Источник — признак roomless в
 * FEATURE_FLAGS (общий контракт): по нему же админка прячет эти режимы.
 */
export const ROOMLESS_FLAGS: readonly FeatureFlagName[] = FLAG_NAMES.filter(isRoomlessFlag);

// ── Флаги ────────────────────────────────────────────────────────────────────

/** Устойчивая «корзина» 0–99 кода комнаты: FNV-1a 32 бит по коду в верхнем регистре. */
export function flagBucket(code: string): number {
  let h = 0x811c9dc5;
  for (const ch of code.toUpperCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/**
 * Включена ли функция (для комнаты, если задана). Без правила — значение по
 * умолчанию из FEATURE_FLAGS. «Процент» и «список» требуют комнату: без неё
 * (страница сайта, создание комнаты) считаем выключенным.
 */
export function isFlagOn(cfg: RuntimeConfig, name: FeatureFlagName, roomCode?: string | null): boolean {
  const rule = cfg.flags[name];
  if (!rule) return FEATURE_FLAGS[name].defaultOn;
  switch (rule.mode) {
    case "on":
      return true;
    case "off":
      return false;
    case "percent":
      return !!roomCode && flagBucket(roomCode) < rule.percent;
    case "list":
      return !!roomCode && rule.rooms.includes(roomCode.toUpperCase());
  }
}

/** Объявления, активные сейчас для места where. */
export function activeAnnouncements(
  cfg: RuntimeConfig,
  where: "site" | "room",
  now: Date = new Date(),
): Announcement[] {
  const t = now.getTime();
  return cfg.announcements.filter((a) => {
    if (a.where !== where && a.where !== "both") return false;
    if (a.startsAt && Date.parse(a.startsAt) > t) return false;
    if (a.endsAt && Date.parse(a.endsAt) <= t) return false;
    return true;
  });
}

/** То, что видит браузер: флаги уже вычислены для комнаты (или сайта). */
export function toPublicConfig(
  cfg: RuntimeConfig,
  roomCode: string | null,
  now: Date = new Date(),
): PublicConfigResponse {
  const flags = Object.fromEntries(
    FLAG_NAMES.map((name) => [name, isFlagOn(cfg, name, roomCode)]),
  ) as Record<FeatureFlagName, boolean>;
  return {
    flags,
    maxScreenQuality: cfg.limits.maxScreenQuality,
    announcements: activeAnnouncements(cfg, roomCode ? "room" : "site", now).map(({ id, text, level }) => ({
      id,
      text,
      level,
    })),
    maintenance: { ...cfg.maintenance },
    rulesVersion: RULES_VERSION,
  };
}

/** Текст режима обслуживания для человека (свой или стандартный). */
export function maintenanceMessage(cfg: RuntimeConfig, fallback: string): string {
  return cfg.maintenance.message.trim() || fallback;
}

/** Запрещено ли создание новых комнат режимом обслуживания. */
export const newRoomsBlocked = (cfg: RuntimeConfig) =>
  cfg.maintenance.enabled && cfg.maintenance.blockNewRooms;
/** Запрещён ли вход в существующие комнаты режимом обслуживания. */
export const joinsBlocked = (cfg: RuntimeConfig) => cfg.maintenance.enabled && cfg.maintenance.blockJoins;

// ── Проверка входящего конфига (строгая) и разбор сохранённого (мягкий) ──────

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const okv = <T>(value: T): Result<T> => ({ ok: true, value });
const err = (message: string): Result<never> => ({ ok: false, message });

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function intIn(x: unknown, min: number, max: number): number | null {
  return typeof x === "number" && Number.isInteger(x) && x >= min && x <= max ? x : null;
}

function isoOrNull(x: unknown): string | null | undefined {
  if (x === null || x === undefined || x === "") return null;
  if (typeof x !== "string" || !Number.isFinite(Date.parse(x))) return undefined;
  return new Date(Date.parse(x)).toISOString();
}

function text(x: unknown, max: number): string | null {
  if (typeof x !== "string") return null;
  const s = x.trim();
  return [...s].length <= max ? s : null;
}

function validateRule(name: string, raw: unknown): Result<FlagRule> {
  if (!isRecord(raw)) return err(`Флаг ${name}: нет правила`);
  switch (raw.mode) {
    case "on":
    case "off":
      return okv({ mode: raw.mode });
    case "percent": {
      const percent = intIn(raw.percent, 0, 100);
      return percent === null ? err(`Флаг ${name}: процент — целое 0–100`) : okv({ mode: "percent", percent });
    }
    case "list": {
      if (!Array.isArray(raw.rooms) || raw.rooms.length > ROOMS_IN_LIST_MAX) {
        return err(`Флаг ${name}: список — до ${ROOMS_IN_LIST_MAX} кодов`);
      }
      const rooms: string[] = [];
      for (const r of raw.rooms) {
        const code = typeof r === "string" ? r.trim().toUpperCase() : "";
        if (!ROOM_CODE_RE.test(code)) return err(`Флаг ${name}: «${String(r)}» — не код комнаты`);
        if (!rooms.includes(code)) rooms.push(code);
      }
      return okv({ mode: "list", rooms });
    }
    default:
      return err(`Флаг ${name}: неизвестный режим`);
  }
}

function validateLimits(raw: unknown): Result<RuntimeLimits> {
  if (!isRecord(raw)) return err("Нет лимитов");
  const maxParticipants = intIn(raw.maxParticipants, 2, MAX_PARTICIPANTS_HARD);
  if (maxParticipants === null) return err(`Людей в комнате — от 2 до ${MAX_PARTICIPANTS_HARD}`);
  const maxRooms = intIn(raw.maxRooms, 0, 100_000);
  if (maxRooms === null) return err("Комнат сразу — целое от 0 (без ограничения)");
  const newRoomsPerMinute = intIn(raw.newRoomsPerMinute, 0, 10_000);
  if (newRoomsPerMinute === null) return err("Новых комнат в минуту — целое от 0 (без ограничения)");
  const maxScreenQuality = SCREEN_CAPS.find((c) => c === raw.maxScreenQuality);
  if (!maxScreenQuality) return err("Качество показа — 720p, 1080p или 1440p");
  const maxScreenShares = intIn(raw.maxScreenShares, 0, 10_000);
  if (maxScreenShares === null) return err("Показов экрана сразу — целое от 0 (без ограничения)");
  // Лимиты рисунков появились позже остальных: нет поля (конфиг или админка
  // старше) — значение по умолчанию, а не отказ всего конфига.
  const b = AVATAR_LIMIT_BOUNDS;
  const d = DEFAULT_RUNTIME_CONFIG.limits;
  const avatarDayBudgetMb =
    raw.avatarDayBudgetMb === undefined
      ? d.avatarDayBudgetMb
      : intIn(raw.avatarDayBudgetMb, b.avatarDayBudgetMb.min, b.avatarDayBudgetMb.max);
  if (avatarDayBudgetMb === null) {
    return err(`Бюджет новых рисунков в сутки — целое от ${b.avatarDayBudgetMb.min} до ${b.avatarDayBudgetMb.max} МБ`);
  }
  const avatarNewPerRoom =
    raw.avatarNewPerRoom === undefined
      ? d.avatarNewPerRoom
      : intIn(raw.avatarNewPerRoom, b.avatarNewPerRoom.min, b.avatarNewPerRoom.max);
  if (avatarNewPerRoom === null) {
    return err(`Новых рисунков на комнату за 10 минут — целое от ${b.avatarNewPerRoom.min} до ${b.avatarNewPerRoom.max}`);
  }
  return okv({
    maxParticipants,
    maxRooms,
    newRoomsPerMinute,
    maxScreenQuality,
    maxScreenShares,
    avatarDayBudgetMb,
    avatarNewPerRoom,
  });
}

function validateAnnouncement(raw: unknown, i: number): Result<Announcement> {
  const n = i + 1;
  if (!isRecord(raw)) return err(`Объявление ${n}: неверный формат`);
  const t = text(raw.text, TEXT_MAX);
  if (!t) return err(`Объявление ${n}: текст от 1 до ${TEXT_MAX} символов`);
  const level = (["info", "warning", "critical"] as const).find((l) => l === raw.level);
  if (!level) return err(`Объявление ${n}: уровень info, warning или critical`);
  const where = (["site", "room", "both"] as const).find((w) => w === raw.where);
  if (!where) return err(`Объявление ${n}: где показывать — site, room или both`);
  const startsAt = isoOrNull(raw.startsAt);
  const endsAt = isoOrNull(raw.endsAt);
  if (startsAt === undefined || endsAt === undefined) return err(`Объявление ${n}: неверная дата`);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return err(`Объявление ${n}: конец раньше начала`);
  }
  const id =
    typeof raw.id === "string" && /^[\w-]{1,64}$/.test(raw.id)
      ? raw.id
      : `a${Date.now().toString(36)}${i}`;
  return okv({ id, text: t, level, where, startsAt, endsAt });
}

function validateMaintenance(raw: unknown): Result<Maintenance> {
  if (!isRecord(raw)) return err("Нет режима обслуживания");
  const message = raw.message === undefined || raw.message === null ? "" : text(raw.message, TEXT_MAX);
  if (message === null) return err(`Текст обслуживания — до ${TEXT_MAX} символов`);
  for (const f of ["enabled", "blockNewRooms", "blockJoins"] as const) {
    if (typeof raw[f] !== "boolean") return err(`Режим обслуживания: ${f} — да или нет`);
  }
  return okv({
    enabled: raw.enabled as boolean,
    message,
    blockNewRooms: raw.blockNewRooms as boolean,
    blockJoins: raw.blockJoins as boolean,
  });
}

/** Строгая проверка конфига от админки (без rev/updatedAt). */
export function validateConfigInput(raw: unknown): Result<Omit<RuntimeConfig, "rev" | "updatedAt">> {
  if (!isRecord(raw)) return err("Нет конфига");
  const flags: RuntimeConfig["flags"] = {};
  if (raw.flags !== undefined) {
    if (!isRecord(raw.flags)) return err("Флаги — объект");
    for (const [name, rule] of Object.entries(raw.flags)) {
      if (!FLAG_NAMES.includes(name as FeatureFlagName)) return err(`Неизвестный флаг ${name}`);
      if (rule === null || rule === undefined) continue;
      const r = validateRule(name, rule);
      if (!r.ok) return r;
      if (isRoomlessFlag(name as FeatureFlagName) && r.value.mode !== "on" && r.value.mode !== "off") {
        return err(
          `Флаг «${FEATURE_FLAGS[name as FeatureFlagName].label}» действует на весь сайт, а не на комнаты: можно только включить или выключить`,
        );
      }
      flags[name as FeatureFlagName] = r.value;
    }
  }
  const limits = validateLimits(raw.limits);
  if (!limits.ok) return limits;
  const list = raw.announcements ?? [];
  if (!Array.isArray(list) || list.length > ANNOUNCEMENTS_MAX) {
    return err(`Объявлений — не больше ${ANNOUNCEMENTS_MAX}`);
  }
  const announcements: Announcement[] = [];
  for (const [i, a] of list.entries()) {
    const r = validateAnnouncement(a, i);
    if (!r.ok) return r;
    if (announcements.some((x) => x.id === r.value.id)) return err(`Объявление ${i + 1}: повтор id`);
    announcements.push(r.value);
  }
  const maintenance = validateMaintenance(raw.maintenance);
  if (!maintenance.ok) return maintenance;
  return okv({ flags, limits: limits.value, announcements, maintenance: maintenance.value });
}

/**
 * Разбор сохранённого конфига: всё, что не проходит проверку, — значение по
 * умолчанию (по частям, чтобы одно битое объявление не сбрасывало флаги).
 */
export function parseStoredConfig(raw: unknown): RuntimeConfig {
  if (typeof raw !== "string" || !raw) return structuredClone(DEFAULT_RUNTIME_CONFIG);
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_RUNTIME_CONFIG);
  }
  if (!isRecord(o)) return structuredClone(DEFAULT_RUNTIME_CONFIG);
  const d = structuredClone(DEFAULT_RUNTIME_CONFIG);
  const flags: RuntimeConfig["flags"] = {};
  if (isRecord(o.flags)) {
    for (const [name, rule] of Object.entries(o.flags)) {
      if (!FLAG_NAMES.includes(name as FeatureFlagName)) continue;
      const r = validateRule(name, rule);
      if (r.ok) flags[name as FeatureFlagName] = r.value;
    }
  }
  const limits = validateLimits(o.limits);
  const announcements = Array.isArray(o.announcements)
    ? o.announcements.slice(0, ANNOUNCEMENTS_MAX).flatMap((a, i) => {
        const r = validateAnnouncement(a, i);
        return r.ok ? [r.value] : [];
      })
    : [];
  const maintenance = validateMaintenance(o.maintenance);
  return {
    flags,
    limits: limits.ok ? limits.value : d.limits,
    announcements,
    maintenance: maintenance.ok ? maintenance.value : d.maintenance,
    rev: typeof o.rev === "number" && Number.isInteger(o.rev) && o.rev >= 0 ? o.rev : 0,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
  };
}

// ── Чтение с кэшем и запись ──────────────────────────────────────────────────

let cache: { at: number; ttl: number; cfg: RuntimeConfig } | null = null;
let inflight: Promise<RuntimeConfig> | null = null;

/** Сбросить кэш (тесты; запись конфига этим же процессом). */
export function resetConfigCache(): void {
  cache = null;
  inflight = null;
}

/** Свежий конфиг из Redis без кэша. Бросает при сбое Redis. */
export async function readRuntimeConfig(): Promise<{ cfg: RuntimeConfig; raw: string | null }> {
  const raw = await getRedisRaw().get(CONFIG_KEY);
  const str = typeof raw === "string" ? raw : null;
  return { cfg: parseStoredConfig(str), raw: str };
}

/**
 * Последний прочитанный конфиг без похода в Redis (умолчания, если ещё не
 * читали). Для синхронных мест — порога лимитера, который маршрут берёт уже
 * после своего loadRuntimeConfig(): кэш к этому моменту свежий (≤ 10 с).
 */
export function peekRuntimeConfig(): RuntimeConfig {
  return cache?.cfg ?? DEFAULT_RUNTIME_CONFIG;
}

/** Конфиг для решений сайта: кэш ≈10 с; при сбое — последний известный или умолчания. Не бросает. */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) return cache.cfg;
  inflight ??= readRuntimeConfig()
    .then(({ cfg }) => {
      cache = { at: Date.now(), ttl: CONFIG_CACHE_MS, cfg };
      return cfg;
    })
    .catch((e: unknown) => {
      console.error("runtime config read failed", e);
      const cfg = cache?.cfg ?? structuredClone(DEFAULT_RUNTIME_CONFIG);
      cache = { at: Date.now(), ttl: CONFIG_RETRY_MS, cfg };
      return cfg;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export type WriteConfigResult =
  | { ok: true; config: RuntimeConfig }
  | { ok: false; conflict: true; current: RuntimeConfig };

/**
 * Записать конфиг, если в Redis сейчас ревизия expectedRev (защита от двух
 * вкладок админки). Атомарно: сравнение-и-замена всей строки скриптом.
 */
export async function writeRuntimeConfig(
  input: Omit<RuntimeConfig, "rev" | "updatedAt">,
  expectedRev: number,
  now: Date = new Date(),
): Promise<WriteConfigResult> {
  const { cfg: current, raw } = await readRuntimeConfig();
  if (current.rev !== expectedRev) return { ok: false, conflict: true, current };
  const next: RuntimeConfig = { ...input, rev: expectedRev + 1, updatedAt: now.toISOString() };
  const res = await getRedisRaw().eval(CAS_STRING_LUA, [CONFIG_KEY], [raw ?? "", JSON.stringify(next)]);
  if (Number(res) !== 1) {
    return { ok: false, conflict: true, current: (await readRuntimeConfig()).cfg };
  }
  cache = { at: Date.now(), ttl: CONFIG_CACHE_MS, cfg: next };
  return { ok: true, config: next };
}
