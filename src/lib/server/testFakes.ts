// Фейки для тестов (vitest) — в приложение не импортируется.
//  • FakeRedis — Redis в памяти с теми командами, что использует сервер (включая
//    наши Lua-скрипты). Сроки жизни ключей считаются по Date.now(): тест двигает
//    время через vi.setSystemTime — и ключи, и паузы сервера идут по одним часам.
//  • FakeLiveKit — RoomServiceClient в памяти: комнаты, участники с правами и
//    треками; отзыв права на источник снимает трек, как настоящий LiveKit.
import { TokenVerifier, TrackSource, TwirpError } from "livekit-server-sdk";
import { CAS_HOST_LUA, CREATE_META_LUA, UPDATE_META_LUA } from "./redisScripts";
import { CAS_STRING_LUA } from "@/lib/platform/scripts";

/** Запись потока (XADD): id и плоский список [поле, значение, …]. */
type StreamEntry = { id: string; fields: string[] };
/** Отсортированное множество: member → score. */
class ZSet extends Map<string, number> {}
/** Поток Redis (XADD/XRANGE). */
class Stream extends Array<StreamEntry> {}

type Value = string | Set<string> | Map<string, string> | string[] | ZSet | Stream;
type SetOptions = { nx?: boolean; ex?: number };

export class FakeRedis {
  private data = new Map<string, Value>();
  private expiry = new Map<string, number>();

  reset(): void {
    this.data.clear();
    this.expiry.clear();
  }

  /** Срок жизни ключа в секундах (для проверок); -1 — без срока, -2 — нет ключа. */
  ttlSec(key: string): number {
    const ms = this.pttlSync(key);
    return ms < 0 ? ms : Math.ceil(ms / 1000);
  }

  keys(): string[] {
    return [...this.data.keys()].filter((k) => this.alive(k));
  }

  private alive(key: string): boolean {
    const exp = this.expiry.get(key);
    if (exp !== undefined && exp <= Date.now()) {
      this.data.delete(key);
      this.expiry.delete(key);
    }
    return this.data.has(key);
  }

  private read<T extends Value>(key: string, kind: (v: Value) => v is T): T | undefined {
    if (!this.alive(key)) return undefined;
    const v = this.data.get(key)!;
    if (!kind(v)) throw new Error(`WRONGTYPE ${key}`);
    return v;
  }

  private str(key: string) {
    return this.read(key, (v): v is string => typeof v === "string");
  }
  private set_(key: string) {
    return this.read(key, (v): v is Set<string> => v instanceof Set);
  }
  private hash(key: string) {
    return this.read(key, (v): v is Map<string, string> => v instanceof Map && !(v instanceof ZSet));
  }
  private zset(key: string) {
    return this.read(key, (v): v is ZSet => v instanceof ZSet);
  }
  private stream(key: string) {
    return this.read(key, (v): v is Stream => v instanceof Stream);
  }
  private list(key: string) {
    return this.read(key, (v): v is string[] => Array.isArray(v) && !(v instanceof Stream));
  }

  private pttlSync(key: string): number {
    if (!this.alive(key)) return -2;
    const exp = this.expiry.get(key);
    return exp === undefined ? -1 : exp - Date.now();
  }

  async get(key: string) {
    return this.str(key) ?? null;
  }
  async set(key: string, value: string, opts: SetOptions = {}) {
    if (opts.nx && this.alive(key)) return null;
    this.data.set(key, String(value));
    if (opts.ex) this.expiry.set(key, Date.now() + opts.ex * 1000);
    else this.expiry.delete(key);
    return "OK";
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) {
      if (this.alive(k)) n++;
      this.data.delete(k);
      this.expiry.delete(k);
    }
    return n;
  }
  async expire(key: string, seconds: number) {
    if (!this.alive(key)) return 0;
    this.expiry.set(key, Date.now() + Number(seconds) * 1000);
    return 1;
  }
  async pttl(key: string) {
    return this.pttlSync(key);
  }
  async sadd(key: string, ...members: string[]) {
    const s = this.set_(key) ?? new Set<string>();
    this.data.set(key, s);
    const before = s.size;
    for (const m of members) s.add(m);
    return s.size - before;
  }
  async srem(key: string, ...members: string[]) {
    const s = this.set_(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) if (s.delete(m)) removed++;
    if (s.size === 0) await this.del(key);
    return removed;
  }
  async sismember(key: string, member: string) {
    return this.set_(key)?.has(member) ? 1 : 0;
  }
  async smembers(key: string) {
    return [...(this.set_(key) ?? [])];
  }
  async hset(key: string, fields: Record<string, string>) {
    const h = this.hash(key) ?? new Map<string, string>();
    this.data.set(key, h);
    let added = 0;
    for (const [f, v] of Object.entries(fields)) {
      if (!h.has(f)) added++;
      h.set(f, String(v));
    }
    return added;
  }
  async hsetnx(key: string, field: string, value: string) {
    const h = this.hash(key) ?? new Map<string, string>();
    this.data.set(key, h);
    if (h.has(field)) return 0;
    h.set(field, String(value));
    return 1;
  }
  async hget(key: string, field: string) {
    return this.hash(key)?.get(field) ?? null;
  }
  /** Как raw-клиент Upstash: плоский массив [поле, значение, …]. */
  async hgetall(key: string) {
    return [...(this.hash(key) ?? new Map<string, string>())].flat();
  }
  async lpush(key: string, ...values: string[]) {
    const l = this.list(key) ?? [];
    this.data.set(key, l);
    l.unshift(...values.reverse());
    return l.length;
  }
  async ltrim(key: string, start: number, stop: number) {
    const l = this.list(key);
    if (l) this.data.set(key, l.slice(start, stop + 1));
    return "OK";
  }
  async lrange(key: string, start: number, stop: number) {
    const l = this.list(key) ?? [];
    return l.slice(start, stop < 0 ? l.length + stop + 1 : stop + 1);
  }
  async incr(key: string) {
    const next = (Number(this.str(key) ?? "0") || 0) + 1;
    const exp = this.expiry.get(key);
    this.data.set(key, String(next));
    if (exp !== undefined) this.expiry.set(key, exp);
    return next;
  }
  async exists(...keys: string[]) {
    return keys.filter((k) => this.alive(k)).length;
  }
  async mget(...keys: string[]) {
    return keys.map((k) => this.str(k) ?? null);
  }
  /** SCAN: за один проход отдаёт всё (курсор "0"); MATCH — только «префикс*». */
  async scan(_cursor: string | number, opts: { match?: string; count?: number } = {}) {
    const prefix = (opts.match ?? "*").replace(/\*$/, "");
    return ["0", this.keys().filter((k) => k.startsWith(prefix))];
  }
  /** ZADD как в Upstash: (key, [opts,] {score, member}, …); из опций — только nx. */
  async zadd(key: string, ...args: Array<{ score: number; member: string } | { nx?: boolean }>) {
    const opts = args[0] && !("member" in args[0]) ? (args.shift() as { nx?: boolean }) : {};
    const entries = args as Array<{ score: number; member: string }>;
    const z = this.zset(key) ?? new ZSet();
    this.data.set(key, z);
    let added = 0;
    for (const { score, member } of entries) {
      if (opts.nx && z.has(member)) continue;
      if (!z.has(member)) added++;
      z.set(member, Number(score));
    }
    return added;
  }
  async zrem(key: string, ...members: string[]) {
    const z = this.zset(key);
    if (!z) return 0;
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    return n;
  }
  /** ZREMRANGEBYRANK: индексы по возрастанию score, отрицательные — с конца. */
  async zremrangebyrank(key: string, start: number, stop: number) {
    const ordered = await this.zrange(key, 0, -1);
    const s = start < 0 ? ordered.length + start : start;
    const e = stop < 0 ? ordered.length + stop : stop;
    if (e < s) return 0;
    return this.zrem(key, ...ordered.slice(Math.max(0, s), e + 1));
  }
  async zremrangebyscore(key: string, min: number, max: number) {
    const z = this.zset(key);
    if (!z) return 0;
    const doomed = [...z.entries()].filter(([, sc]) => sc >= Number(min) && sc <= Number(max)).map(([m]) => m);
    return this.zrem(key, ...doomed);
  }
  async zcard(key: string) {
    return this.zset(key)?.size ?? 0;
  }
  /** ZRANGE по индексам (rev — от больших score к меньшим). */
  async zrange(key: string, start: number, stop: number, opts: { rev?: boolean } = {}) {
    const z = this.zset(key);
    if (!z) return [];
    const sorted = [...z.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    if (opts.rev) sorted.reverse();
    const end = stop < 0 ? sorted.length + stop + 1 : stop + 1;
    return sorted.slice(start, end).map(([m]) => m);
  }
  /** XADD key [MAXLEN ~ n] * поле значение … — как в Upstash: (key, id, entries, opts). */
  async xadd(
    key: string,
    _id: string,
    entries: Record<string, string>,
    opts: { trim?: { threshold: number } } = {},
  ) {
    const st = this.stream(key) ?? new Stream();
    this.data.set(key, st);
    const last = st[st.length - 1]?.id;
    let ms = Date.now();
    let seq = 0;
    if (last) {
      const [lms, lseq] = last.split("-").map(Number);
      if (lms >= ms) {
        ms = lms;
        seq = lseq + 1;
      }
    }
    const id = `${ms}-${seq}`;
    st.push({ id, fields: Object.entries(entries).flatMap(([k, v]) => [k, String(v)]) });
    if (opts.trim && st.length > opts.trim.threshold) st.splice(0, st.length - opts.trim.threshold);
    return id;
  }
  /** XTRIM MINID: стереть записи с id меньше порога. */
  async xtrim(key: string, opts: { strategy: "MAXLEN" | "MINID"; threshold: number | string }) {
    const st = this.stream(key);
    if (!st) return 0;
    const before = st.length;
    if (opts.strategy === "MINID") {
      const min = Number(String(opts.threshold).split("-")[0]);
      const keep = st.filter((e) => Number(e.id.split("-")[0]) >= min);
      st.splice(0, st.length, ...keep);
    } else if (st.length > Number(opts.threshold)) {
      st.splice(0, st.length - Number(opts.threshold));
    }
    return before - st.length;
  }
  /** XRANGE с исключающим началом «(id» — как raw-клиент: [[id, [поле, значение…]], …]. */
  async xrange(key: string, start: string, end: string, count?: number) {
    const st = this.stream(key) ?? [];
    const cmp = (a: string, b: string) => {
      const [am, as] = a.split("-").map(Number);
      const [bm, bs] = b.split("-").map(Number);
      return am - bm || (as || 0) - (bs || 0);
    };
    const out = st.filter((e) => {
      if (start === "-") return true;
      if (start.startsWith("(")) return cmp(e.id, start.slice(1)) > 0;
      return cmp(e.id, start) >= 0;
    }).filter((e) => end === "+" || cmp(e.id, end) <= 0);
    return (count ? out.slice(0, count) : out).map((e) => [e.id, [...e.fields]]);
  }

  /** Эмуляция наших Lua-скриптов (redisScripts.ts) — один в один по смыслу. */
  async eval(script: string, keys: string[], args: string[]) {
    const [k1, k2, k3, k4] = keys;
    if (script === CREATE_META_LUA) {
      if (this.alive(k1)) return 0;
      await this.hset(k1, pairs(args.slice(1)));
      await this.expire(k1, Number(args[0]));
      return 1;
    }
    if (script === UPDATE_META_LUA) {
      if (!this.alive(k1)) return 0;
      await this.hset(k1, pairs(args));
      return this.hincrby(k1, "rev");
    }
    if (script === CAS_STRING_LUA) {
      if ((this.str(k1) ?? "") !== args[0]) return 0;
      const exp = this.expiry.get(k1);
      this.data.set(k1, args[1]);
      if (exp !== undefined) this.expiry.set(k1, exp);
      return 1;
    }
    if (script === CAS_HOST_LUA) {
      if (!this.alive(k1)) return 0;
      if ((this.hash(k1)?.get("hostIdentity") ?? "") !== args[0]) return -1;
      await this.hset(k1, { hostIdentity: args[1], hostName: args[2] });
      await this.del(k2);
      await this.srem(k3, args[1]);
      await this.srem(k4, args[1]);
      return this.hincrby(k1, "rev");
    }
    throw new Error("FakeRedis: неизвестный скрипт");
  }

  private hincrby(key: string, field: string): number {
    const h = this.hash(key)!;
    const next = (Number(h.get(field)) || 0) + 1;
    h.set(field, String(next));
    return next;
  }

  /** Пайплайн: команды копятся и выполняются по очереди в exec(). */
  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const target = this as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const p = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => {
        if (prop === "exec") {
          return async () => {
            const out: unknown[] = [];
            for (const op of ops) out.push(await op());
            return out;
          };
        }
        return (...args: unknown[]) => {
          ops.push(() => target[prop](...args));
          return p;
        };
      },
    });
    return p;
  }
}

function pairs(flat: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

// ── LiveKit ──────────────────────────────────────────────────────────────────

export type FakeTrack = { sid: string; source: TrackSource; muted: boolean };
export type FakePermission = {
  canSubscribe?: boolean;
  canPublish?: boolean;
  canPublishData?: boolean;
  canPublishSources?: TrackSource[];
  canUpdateMetadata?: boolean;
  hidden?: boolean;
};
export type FakeParticipant = {
  identity: string;
  name: string;
  metadata: string;
  /** Атрибуты участника (ключ → значение), как participant.attributes в LiveKit. */
  attributes: Record<string, string>;
  permission: FakePermission;
  tracks: FakeTrack[];
  /** Порядок входа (в LiveKit — секунды с эпохи). */
  joinedAt: bigint;
};
type FakeRoom = { name: string; metadata: string; maxParticipants: number };

const notFound = (what: string) => new TwirpError("Not Found", `${what} not found`, 404, "not_found");

/**
 * Участник так, как его отдаёт Server SDK: тот переводит ВСЕ ключи ответа в
 * camelCase (camelcase-keys, deep), и ключи атрибутов тоже — voice.deafened
 * приходит как voiceDeafened. Фейк повторяет это, чтобы тесты ловили попытку
 * читать атрибуты на сервере.
 */
function sdkView(p: FakeParticipant): FakeParticipant {
  const camel = (key: string) => key.replace(/[._\-\s]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
  return { ...p, attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [camel(k), v])) };
}

/** Может ли участник публиковать источник при таких правах (как в LiveKit). */
export function canPublishSource(p: FakePermission, source: TrackSource): boolean {
  if (!p.canPublish) return false;
  const sources = p.canPublishSources ?? [];
  return sources.length === 0 || sources.includes(source);
}

export class FakeLiveKit {
  rooms = new Map<string, FakeRoom>();
  participants = new Map<string, Map<string, FakeParticipant>>();
  sentData: Array<{ room: string; payload: unknown; topic?: string; kind: number }> = [];
  removed: Array<{ room: string; identity: string }> = [];
  updateCalls: Array<{
    room: string;
    identity: string;
    metadata?: string;
    permission?: FakePermission;
    attributes?: Record<string, string>;
  }> = [];
  mutedTracks: Array<{ room: string; identity: string; sid: string; muted: boolean }> = [];
  private joinSeq = 0n;

  reset(): void {
    this.rooms.clear();
    this.participants.clear();
    this.sentData = [];
    this.removed = [];
    this.updateCalls = [];
    this.mutedTracks = [];
  }

  private roomView(r: FakeRoom) {
    return {
      name: r.name,
      metadata: r.metadata,
      maxParticipants: r.maxParticipants,
      numParticipants: this.participants.get(r.name)?.size ?? 0,
    };
  }

  private people(room: string): Map<string, FakeParticipant> {
    if (!this.rooms.has(room)) throw notFound("room");
    let m = this.participants.get(room);
    if (!m) this.participants.set(room, (m = new Map()));
    return m;
  }

  private person(room: string, identity: string): FakeParticipant {
    const p = this.people(room).get(identity);
    if (!p) throw notFound("participant");
    return p;
  }

  /** Подключить участника (как если бы он вошёл с токеном). */
  join(room: string, p: Partial<FakeParticipant> & { identity: string }): FakeParticipant {
    const full: FakeParticipant = {
      name: p.identity,
      metadata: "",
      attributes: {},
      permission: { canSubscribe: true, canPublish: true, canPublishData: true },
      tracks: [],
      joinedAt: ++this.joinSeq,
      ...p,
    };
    this.people(room).set(p.identity, full);
    return full;
  }

  /** Участник публикует трек — если права позволяют. */
  publish(room: string, identity: string, source: TrackSource): FakeTrack | null {
    const p = this.person(room, identity);
    if (!canPublishSource(p.permission, source)) return null;
    const track = { sid: `TR_${identity}_${source}_${p.tracks.length}`, source, muted: false };
    p.tracks.push(track);
    return track;
  }

  leave(room: string, identity: string): void {
    this.participants.get(room)?.delete(identity);
  }

  async listRooms(names?: string[]) {
    return [...this.rooms.values()]
      .filter((r) => !names?.length || names.includes(r.name))
      .map((r) => this.roomView(r));
  }
  async createRoom(opts: { name: string; metadata?: string; maxParticipants?: number }) {
    let r = this.rooms.get(opts.name);
    if (!r) {
      r = { name: opts.name, metadata: opts.metadata ?? "", maxParticipants: opts.maxParticipants ?? 0 };
      this.rooms.set(opts.name, r);
    }
    return this.roomView(r);
  }
  async deleteRoom(name: string) {
    this.rooms.delete(name);
    this.participants.delete(name);
  }
  async updateRoomMetadata(name: string, metadata: string) {
    const r = this.rooms.get(name);
    if (!r) throw notFound("room");
    r.metadata = metadata;
    return this.roomView(r);
  }
  async listParticipants(room: string) {
    return [...this.people(room).values()].map(sdkView);
  }
  async getParticipant(room: string, identity: string) {
    return sdkView(this.person(room, identity));
  }
  async updateParticipant(
    room: string,
    identity: string,
    opts: { metadata?: string; permission?: FakePermission; attributes?: Record<string, string> },
  ) {
    const p = this.person(room, identity);
    this.updateCalls.push({
      room,
      identity,
      metadata: opts.metadata,
      permission: opts.permission,
      attributes: opts.attributes,
    });
    if (opts.metadata) p.metadata = opts.metadata;
    // Как LiveKit: меняются только перечисленные ключи, пустое значение — удалить.
    for (const [key, value] of Object.entries(opts.attributes ?? {})) {
      if (value === "") delete p.attributes[key];
      else p.attributes[key] = value;
    }
    if (opts.permission) {
      p.permission = { ...opts.permission };
      // Как LiveKit: отозванный источник снимается вместе с треком.
      p.tracks = p.tracks.filter((t) => canPublishSource(p.permission, t.source));
    }
    return p;
  }
  async removeParticipant(room: string, identity: string) {
    this.person(room, identity);
    this.people(room).delete(identity);
    this.removed.push({ room, identity });
  }
  async mutePublishedTrack(room: string, identity: string, sid: string, muted: boolean) {
    const t = this.person(room, identity).tracks.find((x) => x.sid === sid);
    if (!t) throw notFound("track");
    t.muted = muted;
    this.mutedTracks.push({ room, identity, sid, muted });
    return t;
  }
  async sendData(room: string, data: Uint8Array, kind: number, opts: { topic?: string } = {}) {
    if (!this.rooms.has(room)) throw notFound("room");
    this.sentData.push({
      room,
      payload: JSON.parse(new TextDecoder().decode(data)),
      topic: opts.topic,
      kind,
    });
  }
}

// ── Стенд для тестов маршрутов ───────────────────────────────────────────────

/** Ключи и адреса для тестов (HS256 требует секрет не короче 256 бит). */
export const TEST_ENV = {
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "test-secret-test-secret-test-secret-1234",
  LIVEKIT_URL: "http://livekit.test",
  NEXT_PUBLIC_LIVEKIT_URL: "ws://livekit.test",
};

export function applyTestEnv(): void {
  Object.assign(process.env, TEST_ENV);
}

/** POST с JSON-телом (или GET без тела) к маршруту. */
export function jsonRequest(
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://app.test${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Статус и JSON ответа маршрута; T — ожидаемая форма тела (из контракта). */
export async function readResponse<T = Record<string, unknown>>(
  res: Response,
): Promise<{ status: number; body: T }> {
  return { status: res.status, body: (await res.json()) as T };
}

const SOURCE_BY_NAME: Record<string, TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

/**
 * Подключает участника к FakeLiveKit так, как это сделал бы LiveKit по токену:
 * identity, ник, metadata и права — из подписанного JWT.
 */
export async function connectWithToken(lk: FakeLiveKit, token: string): Promise<FakeParticipant> {
  const claims = await new TokenVerifier(TEST_ENV.LIVEKIT_API_KEY, TEST_ENV.LIVEKIT_API_SECRET).verify(token);
  const video = claims.video ?? {};
  const sources = (video.canPublishSources ?? []) as unknown as string[];
  return lk.join(String(video.room), {
    identity: String(claims.sub),
    name: claims.name ?? "",
    metadata: claims.metadata ?? "",
    permission: {
      canSubscribe: video.canSubscribe,
      canPublish: video.canPublish,
      canPublishData: video.canPublishData,
      canPublishSources: sources.map((s) => SOURCE_BY_NAME[s]),
      canUpdateMetadata: video.canUpdateOwnMetadata,
    },
  });
}
