// Состояние комнаты в Redis — источник правды для сервера. metadata LiveKit видят
// все участники, и она пропадает при перезапуске LiveKit, поэтому всё хранится
// здесь, а в LiveKit уходит только зеркало публичной части (server/roomSync.ts).
// (Имя модуля историческое: раньше тут лежали только секреты.)
//
//   room:<CODE>:meta            HASH   описание и настройки (StoredRoomMeta) + rev
//   room:<CODE>:auth            STRING JSON { passwordHash, hostKeyHash }
//   room:<CODE>:seats           HASH   identity → sha256(secret устройства) — TOFU
//   room:<CODE>:names           HASH   identity → последний ник (баны, подписи)
//   room:<CODE>:members         SET    кто уже был в комнате (вернётся и в запертую)
//   room:<CODE>:banned          SET
//   room:<CODE>:muted           SET    принудительный мьют
//   room:<CODE>:chatMuted       SET    запрет чата
//   room:<CODE>:screenAllowed   SET    показ экрана разрешён (режим approved)
//   room:<CODE>:hostLeftAt      STRING мс, когда хост вышел (вебхук participant_left)
//   room:<CODE>:chat            LIST   последние сообщения чата, новые слева
//   room:<CODE>:kick:<identity> STRING с TTL — запрет входа после кика
//
// Каждая изменяемая коллекция — отдельный ключ с атомарными командами, поэтому
// параллельные действия не затирают друг друга. Условные изменения описания (кто
// хост) делаются Lua-скриптом за одну операцию.
//
// Сроки жизни: 48 ч, продлеваются на любом вебхуке, действии хоста и сообщении
// чата. После room_finished ключи живут ещё 15 минут — «на возвращение»: если весь
// клуб разом потерял интернет дольше, чем LiveKit держит пустую комнату, первый
// вернувшийся пересоздаст её с теми же настройками, банами и историей чата.
import {
  CHAT_HISTORY_LIMIT,
  CHAT_POLICIES,
  parseRoomBadge,
  SCREEN_POLICIES,
  type BanEntry,
  type ChatMessage,
  type ChatPolicy,
  type RoomSettings,
  type ScreenPolicy,
} from "@/lib/api/contract";
import type { RoomBadge } from "@/lib/api/platform";
import { getRedisRaw } from "./redis";
import { CAS_HOST_LUA, CREATE_META_LUA, UPDATE_META_LUA } from "./server/redisScripts";

export const ROOM_STATE_TTL_SECONDS = 48 * 60 * 60;
export const ROOM_FINISHED_GRACE_SECONDS = 15 * 60;

export type RoomAuth = {
  /** null — пароля нет; иначе "salt:hash" (см. hashPassword). */
  passwordHash: string | null;
  /** Хэш ключа владельца ("salt:hash"). */
  hostKeyHash: string;
};

/** Описание комнаты в Redis. Публичная часть уходит в room.metadata. */
export type StoredRoomMeta = {
  title: string;
  isPublic: boolean;
  createdAt: number;
  hostIdentity: string | null;
  hostName: string | null;
  ownerIdentity: string | null;
  locked: boolean;
  hasPassword: boolean;
  settings: RoomSettings;
  /** Бейдж клуба (комната создана по ключу); null — обычная комната. Публичный. */
  badge: RoomBadge | null;
  /** Ключ, по которому создана комната (id из gr:key:*); только в Redis. */
  keyId: string | null;
  /** Людей в комнате по ключу; null — общий лимит из настроек продукта. */
  maxParticipants: number | null;
  /** Счётчик изменений: по нему зеркало в LiveKit замечает устаревший снимок. */
  rev: number;
};

/** Поля комнаты по ключу клуба: у обычной комнаты все null. */
export const NO_KEY = { badge: null, keyId: null, maxParticipants: null } as const;

/** Изменяемые поля описания (createdAt и rev ведёт сервер). */
export type RoomMetaPatch = Partial<
  Pick<
    StoredRoomMeta,
    "title" | "isPublic" | "hostIdentity" | "hostName" | "ownerIdentity" | "locked" | "hasPassword"
  >
> & { screen?: ScreenPolicy; chat?: ChatPolicy };

const key = {
  meta: (c: string) => `room:${c}:meta`,
  auth: (c: string) => `room:${c}:auth`,
  seats: (c: string) => `room:${c}:seats`,
  names: (c: string) => `room:${c}:names`,
  members: (c: string) => `room:${c}:members`,
  banned: (c: string) => `room:${c}:banned`,
  muted: (c: string) => `room:${c}:muted`,
  chatMuted: (c: string) => `room:${c}:chatMuted`,
  screenAllowed: (c: string) => `room:${c}:screenAllowed`,
  hostLeftAt: (c: string) => `room:${c}:hostLeftAt`,
  chat: (c: string) => `room:${c}:chat`,
  kick: (c: string, identity: string) => `room:${c}:kick:${identity}`,
};

/** Все ключи комнаты, кроме кик-блоков (у тех свой короткий срок). */
function roomKeys(code: string): string[] {
  return [
    key.meta(code),
    key.auth(code),
    key.seats(code),
    key.names(code),
    key.members(code),
    key.banned(code),
    key.muted(code),
    key.chatMuted(code),
    key.screenAllowed(code),
    key.hostLeftAt(code),
    key.chat(code),
  ];
}

// ── Кодирование описания (HASH: всё строками) ─────────────────────────────────

const flag = (b: boolean) => (b ? "1" : "0");

function encodePatch(patch: RoomMetaPatch): string[] {
  const out: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out.push(field, typeof value === "boolean" ? flag(value) : (value ?? ""));
  }
  return out;
}

function encodeMeta(meta: Omit<StoredRoomMeta, "rev">): string[] {
  return [
    "createdAt",
    String(meta.createdAt),
    ...encodePatch({
      title: meta.title,
      isPublic: meta.isPublic,
      hostIdentity: meta.hostIdentity,
      hostName: meta.hostName,
      ownerIdentity: meta.ownerIdentity,
      locked: meta.locked,
      hasPassword: meta.hasPassword,
      screen: meta.settings.screen,
      chat: meta.settings.chat,
    }),
    // Поля ключа клуба пишутся только при создании (менять их нечем).
    ...(meta.badge ? ["badge", JSON.stringify(meta.badge)] : []),
    ...(meta.keyId ? ["keyId", meta.keyId] : []),
    ...(meta.maxParticipants ? ["maxParticipants", String(meta.maxParticipants)] : []),
    "rev",
    "1",
  ];
}

/** Raw-клиент отдаёт HGETALL плоским массивом [поле, значение, …]. */
function toRecord(raw: unknown): Record<string, string> | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
    return out;
  }
  if (typeof raw === "object" && raw !== null) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  }
  return null;
}

function pick<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T {
  return allowed.find((x) => x === value) ?? fallback;
}

function parseBadgeField(raw: string | undefined): RoomBadge | null {
  if (!raw) return null;
  try {
    return parseRoomBadge(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
}

function decodeMeta(raw: unknown): StoredRoomMeta | null {
  const r = toRecord(raw);
  if (!r?.title) return null;
  const createdAt = Number(r.createdAt);
  if (!Number.isFinite(createdAt)) return null;
  return {
    title: r.title,
    isPublic: r.isPublic === "1",
    createdAt,
    hostIdentity: r.hostIdentity || null,
    hostName: r.hostName || null,
    ownerIdentity: r.ownerIdentity || null,
    locked: r.locked === "1",
    hasPassword: r.hasPassword === "1",
    settings: {
      screen: pick(SCREEN_POLICIES, r.screen, "all"),
      chat: pick(CHAT_POLICIES, r.chat, "all"),
    },
    badge: parseBadgeField(r.badge),
    keyId: r.keyId || null,
    maxParticipants: Number(r.maxParticipants) > 0 ? Number(r.maxParticipants) : null,
    rev: Number(r.rev) || 0,
  };
}

// auth — JSON-строкой, а не HASH: строка читается raw-клиентом как есть, и
// авто-разбор не превратит хэш из одних цифр в число.
function parseAuth(raw: unknown): RoomAuth | null {
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw) as { hostKeyHash?: unknown; passwordHash?: unknown };
    if (typeof o.hostKeyHash !== "string" || !o.hostKeyHash) return null;
    return {
      hostKeyHash: o.hostKeyHash,
      passwordHash: typeof o.passwordHash === "string" ? o.passwordHash : null,
    };
  } catch {
    return null;
  }
}

const isMember = (x: unknown) => x === 1 || x === "1";

// ── Жизненный цикл ────────────────────────────────────────────────────────────

/**
 * Создаёт состояние новой комнаты. false — код уже занят (описание есть), нужен
 * другой. Остатки прежней комнаты с тем же кодом, чей срок ещё не вышел, стираются.
 */
export async function createRoomState(
  code: string,
  init: { meta: Omit<StoredRoomMeta, "rev">; auth: RoomAuth },
): Promise<boolean> {
  const redis = getRedisRaw();
  const created = await redis.eval(
    CREATE_META_LUA,
    [key.meta(code)],
    [String(ROOM_STATE_TTL_SECONDS), ...encodeMeta(init.meta)],
  );
  if (Number(created) !== 1) return false;
  const p = redis.pipeline();
  p.del(...roomKeys(code).filter((k) => k !== key.meta(code)));
  p.set(key.auth(code), JSON.stringify(init.auth), { ex: ROOM_STATE_TTL_SECONDS });
  await p.exec();
  return true;
}

/** Стереть состояние целиком (откат неудачного создания комнаты). */
export async function deleteRoomState(code: string): Promise<void> {
  await getRedisRaw().del(...roomKeys(code));
}

async function expireAll(code: string, seconds: number): Promise<void> {
  const p = getRedisRaw().pipeline();
  for (const k of roomKeys(code)) p.expire(k, seconds);
  await p.exec();
}

/** Продлить жизнь состояния на полный срок (любая активность в комнате). */
export const touchRoomState = (code: string): Promise<void> =>
  expireAll(code, ROOM_STATE_TTL_SECONDS);

/** Комната закрылась в LiveKit: оставить состояние ещё на ROOM_FINISHED_GRACE_SECONDS. */
export const expireRoomStateSoon = (code: string): Promise<void> =>
  expireAll(code, ROOM_FINISHED_GRACE_SECONDS);

// ── Описание ─────────────────────────────────────────────────────────────────

export async function loadRoomMeta(code: string): Promise<StoredRoomMeta | null> {
  const raw: unknown = await getRedisRaw().hgetall(key.meta(code));
  return decodeMeta(raw);
}

/** Текущий rev описания; null — описания нет. */
export async function loadMetaRev(code: string): Promise<number | null> {
  const raw = await getRedisRaw().hget(key.meta(code), "rev");
  return raw === null || raw === undefined ? null : Number(raw);
}

/** Создать описание, если его нет (перенос старой комнаты, см. roomSync). */
export async function createMetaIfMissing(
  code: string,
  meta: Omit<StoredRoomMeta, "rev">,
): Promise<boolean> {
  const created = await getRedisRaw().eval(
    CREATE_META_LUA,
    [key.meta(code)],
    [String(ROOM_STATE_TTL_SECONDS), ...encodeMeta(meta)],
  );
  return Number(created) === 1;
}

/** Изменить поля описания. false — комнаты нет. */
export async function updateRoomMeta(code: string, patch: RoomMetaPatch): Promise<boolean> {
  const fields = encodePatch(patch);
  if (fields.length === 0) return true;
  const rev = await getRedisRaw().eval(UPDATE_META_LUA, [key.meta(code)], fields);
  return Number(rev) > 0;
}

/** Сменить хоста при условии, что сейчас хост — expected (null — хоста нет). */
export async function casHost(
  code: string,
  expected: string | null,
  next: { identity: string; name: string },
): Promise<"ok" | "conflict" | "missing"> {
  const res = Number(
    await getRedisRaw().eval(
      CAS_HOST_LUA,
      [key.meta(code), key.hostLeftAt(code), key.muted(code), key.chatMuted(code)],
      [expected ?? "", next.identity, next.name],
    ),
  );
  if (res > 0) return "ok";
  return res === 0 ? "missing" : "conflict";
}

// ── Пароль и ключ владельца ───────────────────────────────────────────────────

export async function loadAuth(code: string): Promise<RoomAuth | null> {
  return parseAuth(await getRedisRaw().get(key.auth(code)));
}

/**
 * auth многих комнат за один запрос (витрина без N+1). В Map есть КАЖДЫЙ код:
 * null — состояния нет. Сбой самого запроса пробрасывается.
 */
export async function loadAuthMany(codes: string[]): Promise<Map<string, RoomAuth | null>> {
  const result = new Map<string, RoomAuth | null>();
  if (codes.length === 0) return result;
  const p = getRedisRaw().pipeline();
  for (const code of codes) p.get(key.auth(code));
  const raws = (await p.exec()) as unknown[];
  codes.forEach((code, i) => result.set(code, parseAuth(raws[i])));
  return result;
}

/** Задать или снять пароль (null). false — комнаты нет. */
export async function setPasswordHash(code: string, passwordHash: string | null): Promise<boolean> {
  const auth = await loadAuth(code);
  if (!auth) return false;
  await getRedisRaw().set(key.auth(code), JSON.stringify({ ...auth, passwordHash }), {
    ex: ROOM_STATE_TTL_SECONDS,
  });
  return updateRoomMeta(code, { hasPassword: passwordHash !== null });
}

// ── Снимки для решений ────────────────────────────────────────────────────────

/** Всё, что нужно /api/token о входящем, за один запрос к Redis. */
export type JoinSnapshot = {
  meta: StoredRoomMeta | null;
  auth: RoomAuth | null;
  /** sha256 секрета, за которым закреплено место; null — место свободно. */
  seatHash: string | null;
  banned: boolean;
  member: boolean;
  forceMuted: boolean;
  chatMuted: boolean;
  screenAllowed: boolean;
  /** Сколько секунд ещё действует кик; 0 — не кикнут. */
  kickRemainingSec: number;
};

export async function loadJoinSnapshot(code: string, identity: string): Promise<JoinSnapshot> {
  const p = getRedisRaw().pipeline();
  p.hgetall(key.meta(code));
  p.get(key.auth(code));
  p.hget(key.seats(code), identity);
  p.sismember(key.banned(code), identity);
  p.sismember(key.members(code), identity);
  p.sismember(key.muted(code), identity);
  p.sismember(key.chatMuted(code), identity);
  p.sismember(key.screenAllowed(code), identity);
  p.pttl(key.kick(code, identity));
  const [meta, auth, seat, banned, member, muted, chatMuted, screen, kickTtl] =
    (await p.exec()) as unknown[];
  const kickMs = Number(kickTtl);
  return {
    meta: decodeMeta(meta),
    auth: parseAuth(auth),
    seatHash: typeof seat === "string" && seat ? seat : null,
    banned: isMember(banned),
    member: isMember(member),
    forceMuted: isMember(muted),
    chatMuted: isMember(chatMuted),
    screenAllowed: isMember(screen),
    kickRemainingSec: kickMs > 0 ? Math.ceil(kickMs / 1000) : 0,
  };
}

/** Флаги участников, от которых зависят права (см. permissionFor). */
export type RoomFlags = {
  muted: ReadonlySet<string>;
  chatMuted: ReadonlySet<string>;
  screenAllowed: ReadonlySet<string>;
};

const asSet = (raw: unknown) =>
  new Set(Array.isArray(raw) ? raw.map((x) => String(x)) : []);

/** Описание + флаги всех участников — для пересчёта прав присутствующих. */
export async function loadRoomFlags(
  code: string,
): Promise<{ meta: StoredRoomMeta | null; flags: RoomFlags }> {
  const p = getRedisRaw().pipeline();
  p.hgetall(key.meta(code));
  p.smembers(key.muted(code));
  p.smembers(key.chatMuted(code));
  p.smembers(key.screenAllowed(code));
  const [meta, muted, chatMuted, screenAllowed] = (await p.exec()) as unknown[];
  return {
    meta: decodeMeta(meta),
    flags: { muted: asSet(muted), chatMuted: asSet(chatMuted), screenAllowed: asSet(screenAllowed) },
  };
}

/** Кик-блок и бан одного участника — для вебхука participant_joined. */
export async function loadEntryBlocks(
  code: string,
  identity: string,
): Promise<{ banned: boolean; member: boolean; kickRemainingSec: number }> {
  const p = getRedisRaw().pipeline();
  p.sismember(key.banned(code), identity);
  p.sismember(key.members(code), identity);
  p.pttl(key.kick(code, identity));
  const [banned, member, kickTtl] = (await p.exec()) as unknown[];
  const kickMs = Number(kickTtl);
  return {
    banned: isMember(banned),
    member: isMember(member),
    kickRemainingSec: kickMs > 0 ? Math.ceil(kickMs / 1000) : 0,
  };
}

// ── Места (TOFU) ─────────────────────────────────────────────────────────────

/**
 * Закрепить место за устройством, если оно свободно. bound: false — место уже
 * чьё-то; storedHash — с чем сверять (сверяет вызывающий, за постоянное время).
 */
export async function bindSeat(
  code: string,
  identity: string,
  secretHash: string,
): Promise<{ bound: true } | { bound: false; storedHash: string | null }> {
  const p = getRedisRaw().pipeline();
  p.hsetnx(key.seats(code), identity, secretHash);
  p.hget(key.seats(code), identity);
  p.expire(key.seats(code), ROOM_STATE_TTL_SECONDS);
  const [set, stored] = (await p.exec()) as unknown[];
  if (Number(set) === 1) return { bound: true };
  return { bound: false, storedHash: typeof stored === "string" ? stored : null };
}

// ── Флаги участников ─────────────────────────────────────────────────────────

export type ParticipantFlag = "members" | "banned" | "muted" | "chatMuted" | "screenAllowed";

/** Поставить или снять флаг участника (атомарно и идемпотентно). */
export async function setParticipantFlag(
  code: string,
  flagName: ParticipantFlag,
  identity: string,
  on: boolean,
): Promise<void> {
  const k = key[flagName](code);
  const p = getRedisRaw().pipeline();
  if (on) p.sadd(k, identity);
  else p.srem(k, identity);
  p.expire(k, ROOM_STATE_TTL_SECONDS);
  await p.exec();
}

/** Запомнить последний ник участника (для списка банов и подписей). */
export async function rememberName(code: string, identity: string, name: string): Promise<void> {
  const p = getRedisRaw().pipeline();
  p.hset(key.names(code), { [identity]: name });
  p.expire(key.names(code), ROOM_STATE_TTL_SECONDS);
  await p.exec();
}

/** Последний ник участника; null — сервер его не знает (не входил в комнату). */
export async function loadName(code: string, identity: string): Promise<string | null> {
  const raw = await getRedisRaw().hget(key.names(code), identity);
  return typeof raw === "string" ? raw : null;
}

/** Список банов с последними известными никами. */
export async function loadBans(code: string): Promise<BanEntry[]> {
  const p = getRedisRaw().pipeline();
  p.smembers(key.banned(code));
  p.hgetall(key.names(code));
  const [banned, names] = (await p.exec()) as unknown[];
  const nameOf = toRecord(names) ?? {};
  return [...asSet(banned)].map((identity) => ({ identity, name: nameOf[identity] ?? identity }));
}

// ── Кик ──────────────────────────────────────────────────────────────────────

/** Закрыть вход после кика на seconds (ключ сам исчезнет). */
export async function blockAfterKick(code: string, identity: string, seconds: number): Promise<void> {
  await getRedisRaw().set(key.kick(code, identity), "1", { ex: seconds });
}

export async function clearKick(code: string, identity: string): Promise<void> {
  await getRedisRaw().del(key.kick(code, identity));
}

// ── Уход хоста ───────────────────────────────────────────────────────────────

/** Отметить время ухода хоста. onlyIfMissing — не сдвигать уже идущий отсчёт. */
export async function markHostLeft(code: string, at: number, onlyIfMissing = false): Promise<void> {
  const opts = onlyIfMissing
    ? { ex: ROOM_STATE_TTL_SECONDS, nx: true as const }
    : { ex: ROOM_STATE_TTL_SECONDS };
  await getRedisRaw().set(key.hostLeftAt(code), String(at), opts);
}

export async function loadHostLeftAt(code: string): Promise<number | null> {
  const raw = await getRedisRaw().get(key.hostLeftAt(code));
  const at = Number(raw);
  return raw !== null && raw !== undefined && Number.isFinite(at) ? at : null;
}

export async function clearHostLeft(code: string): Promise<void> {
  await getRedisRaw().del(key.hostLeftAt(code));
}

// ── Чат ──────────────────────────────────────────────────────────────────────

export async function appendChatMessage(code: string, message: ChatMessage): Promise<void> {
  const k = key.chat(code);
  const p = getRedisRaw().pipeline();
  p.lpush(k, JSON.stringify(message));
  p.ltrim(k, 0, CHAT_HISTORY_LIMIT - 1);
  p.expire(k, ROOM_STATE_TTL_SECONDS);
  await p.exec();
}

function parseChatMessage(raw: unknown): ChatMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const m = JSON.parse(raw) as Partial<ChatMessage>;
    if (
      typeof m.id === "string" &&
      typeof m.ts === "number" &&
      typeof m.text === "string" &&
      typeof m.from?.identity === "string" &&
      typeof m.from.name === "string"
    ) {
      const message: ChatMessage = {
        id: m.id,
        ts: m.ts,
        text: m.text,
        from: { identity: m.from.identity, name: m.from.name },
      };
      if (m.system === true) message.system = true;
      return message;
    }
  } catch {
    // битую запись просто пропускаем
  }
  return null;
}

/** История чата от старых к новым. */
export async function loadChatHistory(code: string): Promise<ChatMessage[]> {
  const raw: unknown = await getRedisRaw().lrange(key.chat(code), 0, CHAT_HISTORY_LIMIT - 1);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseChatMessage)
    .filter((m): m is ChatMessage => m !== null)
    .reverse();
}
