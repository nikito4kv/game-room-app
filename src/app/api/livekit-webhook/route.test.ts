import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackSource } from "livekit-server-sdk";
import { FakeLiveKit, FakeRedis } from "@/lib/server/testFakes";

// Вебхук на фейковых Redis и LiveKit. Подпись подменяем: receive отдаёт событие
// как есть. Аналитику мокаем — тут важна только маршрутизация вызовов.
// Моки типизированы как (...args: unknown[]): иначе проброс `(...args) => h.fn(...args)`
// ниже не проходит тайпчек (спред в функцию без rest-параметра — TS2556).
type AsyncMock<T> = (...args: unknown[]) => Promise<T>;
const h = vi.hoisted(() => ({
  redis: null as unknown,
  livekit: null as unknown,
  receive: vi.fn(),
  recordJoin: vi.fn<AsyncMock<void>>(async () => {}),
  readStats: vi.fn<AsyncMock<{ peak: number; totalUnique: number; isPublic: boolean }>>(async () => ({
    peak: 0,
    totalUnique: 0,
    isPublic: false,
  })),
  cleanupStats: vi.fn<AsyncMock<void>>(async () => {}),
  captureRoomSession: vi.fn<AsyncMock<void>>(async () => {}),
}));

vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));
vi.mock("@/lib/livekit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/livekit")>()),
  getRoomService: () => h.livekit,
  getWebhookReceiver: () => ({ receive: h.receive }),
}));
vi.mock("@/lib/analytics/roomStats", () => ({
  recordJoin: (...args: unknown[]) => h.recordJoin(...args),
  readStats: (...args: unknown[]) => h.readStats(...args),
  cleanupStats: (...args: unknown[]) => h.cleanupStats(...args),
}));
vi.mock("@/lib/analytics/posthogServer", () => ({
  captureRoomSession: (...args: unknown[]) => h.captureRoomSession(...args),
}));

import {
  DEFAULT_ROOM_SETTINGS,
  parseParticipantPublicMeta,
  parseRoomPublicMeta,
} from "@/lib/api/contract";
import {
  ROOM_FINISHED_GRACE_SECONDS,
  ROOM_STATE_TTL_SECONDS,
  blockAfterKick,
  createRoomState,
  loadHostLeftAt,
  loadJoinSnapshot,
  markHostLeft,
  setParticipantFlag,
  updateRoomMeta,
} from "@/lib/roomSecret";
import { POST } from "./route";

const CODE = "ABC123";
const HOST = "u_hostxxxxxxxxxxxxxxxxx";
const GUEST = "u_guestxxxxxxxxxxxxxxxx";
let lk: FakeLiveKit;
let redis: FakeRedis;
let eventSeq = 0;

function post(event: Record<string, unknown>): Promise<Response> {
  h.receive.mockResolvedValueOnce({ id: `EV_${++eventSeq}`, createdAt: 0n, ...event });
  return POST(new Request("http://test/api/livekit-webhook", { method: "POST", body: "{}" }));
}

const lkRoom = () => ({ name: CODE, metadata: lk.rooms.get(CODE)?.metadata ?? "", numParticipants: 2 });

/** Участник в LiveKit и событие его входа. */
function joined(identity: string, name = "Гость") {
  const p = lk.join(CODE, { identity, name });
  return post({ event: "participant_joined", room: lkRoom(), participant: { ...p } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  redis = new FakeRedis();
  h.redis = redis;
  lk = new FakeLiveKit();
  h.livekit = lk;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T21:00:00Z"));
  await createRoomState(CODE, {
    meta: {
      title: "Комната",
      isPublic: true,
      createdAt: Date.now(),
      hostIdentity: HOST,
      hostName: "Хост",
      ownerIdentity: HOST,
      locked: false,
      hasPassword: false,
      settings: DEFAULT_ROOM_SETTINGS,
      badge: null,
      keyId: null,
      maxParticipants: null,
    },
    auth: { passwordHash: null, hostKeyHash: "k:h" },
  });
  await lk.createRoom({ name: CODE, metadata: "" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("подпись и дедупликация", () => {
  it("неверная подпись — 401", async () => {
    h.receive.mockRejectedValueOnce(new Error("bad sig"));
    const res = await POST(new Request("http://test/api/livekit-webhook", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("одно и то же событие обрабатывается один раз", async () => {
    const p = lk.join(CODE, { identity: GUEST, name: "Гость" });
    const event = { id: "SAME", createdAt: 0n, event: "participant_joined", room: lkRoom(), participant: { ...p } };
    h.receive.mockResolvedValueOnce(event).mockResolvedValueOnce(event);
    await POST(new Request("http://test/api/livekit-webhook", { method: "POST", body: "{}" }));
    await POST(new Request("http://test/api/livekit-webhook", { method: "POST", body: "{}" }));
    expect(h.recordJoin).toHaveBeenCalledTimes(1);
  });
});

describe("participant_joined — принуждение на входе", () => {
  it("забаненный выкидывается с причиной", async () => {
    await setParticipantFlag(CODE, "banned", GUEST, true);
    await joined(GUEST);
    expect(lk.removed).toEqual([{ room: CODE, identity: GUEST }]);
    const reason = lk.updateCalls.find((u) => u.identity === GUEST)?.metadata;
    expect(parseParticipantPublicMeta(reason).removed).toEqual({ reason: "ban" });
  });

  it("кикнутый со старым токеном — тоже, с остатком блока", async () => {
    await blockAfterKick(CODE, GUEST, 300);
    vi.setSystemTime(Date.now() + 100_000);
    await joined(GUEST);
    expect(lk.removed).toEqual([{ room: CODE, identity: GUEST }]);
    const reason = lk.updateCalls.find((u) => u.identity === GUEST)?.metadata;
    expect(parseParticipantPublicMeta(reason).removed).toEqual({ reason: "kick", retryAfterSec: 200 });
  });

  it("запертая комната: чужого выкидывает, «своего» и владельца — нет", async () => {
    await updateRoomMeta(CODE, { locked: true });
    await joined(GUEST);
    expect(lk.removed).toEqual([{ room: CODE, identity: GUEST }]);

    lk.removed = [];
    await setParticipantFlag(CODE, "members", "u_memberxxxxxxxxxxxxxxx", true);
    await joined("u_memberxxxxxxxxxxxxxxx");
    await setParticipantFlag(CODE, "banned", HOST, true); // даже бан владельца не действует
    await joined(HOST, "Хост");
    expect(lk.removed).toEqual([]);
  });

  it("пущенный становится «своим», его ник запоминается, права применяются", async () => {
    await setParticipantFlag(CODE, "muted", GUEST, true);
    await joined(GUEST, "Боря");
    const snap = await loadJoinSnapshot(CODE, GUEST);
    expect(snap.member).toBe(true);
    const p = lk.participants.get(CODE)?.get(GUEST);
    expect(p?.permission.canPublishSources).toEqual([TrackSource.SCREEN_SHARE]);
    expect(p?.permission.canPublishData).toBe(false);
    expect(parseParticipantPublicMeta(p?.metadata).forceMuted).toBe(true);
  });

  it("вернувшийся хост стирает отметку ухода", async () => {
    await markHostLeft(CODE, Date.now());
    await joined(HOST, "Хост");
    expect(await loadHostLeftAt(CODE)).toBeNull();
  });

  it("чужая комната (нет состояния) — ничего не делаем", async () => {
    await lk.createRoom({ name: "OTHER1" });
    const p = lk.join("OTHER1", { identity: GUEST });
    const res = await post({ event: "participant_joined", room: { name: "OTHER1" }, participant: { ...p } });
    expect(res.status).toBe(200);
    expect(lk.updateCalls).toEqual([]);
    expect(lk.removed).toEqual([]);
  });
});

describe("participant_left — уход хоста", () => {
  it("ушёл хост — отметка времени ухода (время события)", async () => {
    const leftAt = Math.floor(Date.now() / 1000) - 3;
    await post({ event: "participant_left", createdAt: BigInt(leftAt), room: lkRoom(), participant: { identity: HOST } });
    expect(await loadHostLeftAt(CODE)).toBe(leftAt * 1000);
  });

  it("хост уже снова в комнате (другая вкладка) — отсчёт не начинаем", async () => {
    lk.join(CODE, { identity: HOST });
    await post({ event: "participant_left", room: lkRoom(), participant: { identity: HOST } });
    expect(await loadHostLeftAt(CODE)).toBeNull();
  });

  it("ушёл гость — отметки нет", async () => {
    await post({ event: "participant_left", room: lkRoom(), participant: { identity: GUEST } });
    expect(await loadHostLeftAt(CODE)).toBeNull();
  });
});

describe("комната", () => {
  it("room_started с пустой metadata — заполняется из Redis", async () => {
    await post({ event: "room_started", room: { name: CODE, metadata: "" } });
    expect(parseRoomPublicMeta(lk.rooms.get(CODE)?.metadata)).toMatchObject({
      title: "Комната",
      hostIdentity: HOST,
    });
  });

  it("любое событие продлевает состояние до 48 ч, room_finished — сокращает до 15 минут", async () => {
    vi.setSystemTime(Date.now() + 3_600_000);
    await post({ event: "track_published", room: lkRoom(), participant: { identity: GUEST } });
    expect(redis.ttlSec(`room:${CODE}:meta`)).toBe(ROOM_STATE_TTL_SECONDS);
    await post({ event: "room_finished", room: { name: CODE, metadata: "" } });
    expect(redis.ttlSec(`room:${CODE}:meta`)).toBe(ROOM_FINISHED_GRACE_SECONDS);
    expect(redis.ttlSec(`room:${CODE}:auth`)).toBe(ROOM_FINISHED_GRACE_SECONDS);
  });
});

describe("аналитика", () => {
  it("participant_joined → recordJoin с numParticipants и isPublic из payload", async () => {
    const metadata = JSON.stringify({ title: "t", hostIdentity: "h", createdAt: 1, isPublic: true });
    const p = lk.join(CODE, { identity: GUEST });
    const res = await post({
      event: "participant_joined",
      room: { name: CODE, numParticipants: 3, metadata },
      participant: { ...p },
    });
    expect(res.status).toBe(200);
    expect(h.recordJoin).toHaveBeenCalledWith(CODE, GUEST, 3, true);
  });

  it("room_finished с участниками → captureRoomSession + cleanup ПОСЛЕ отправки", async () => {
    h.readStats.mockResolvedValueOnce({ peak: 2, totalUnique: 2, isPublic: true });
    const res = await post({
      event: "room_finished",
      createdAt: 1000n,
      room: {
        name: CODE,
        creationTime: 940n,
        metadata: JSON.stringify({ title: "t", hostIdentity: "h", createdAt: 1, isPublic: true }),
      },
    });
    expect(res.status).toBe(200);
    expect(h.captureRoomSession).toHaveBeenCalledWith({
      code: CODE,
      peak: 2,
      totalUnique: 2,
      durationSec: 60,
      isPublic: true,
    });
    expect(h.cleanupStats).toHaveBeenCalledWith(CODE);
  });

  it("isPublic берётся из сохранённой статистики, если в payload нет metadata", async () => {
    h.readStats.mockResolvedValueOnce({ peak: 1, totalUnique: 1, isPublic: true });
    await post({ event: "room_finished", createdAt: 1000n, room: { name: CODE, creationTime: 990n, metadata: "" } });
    expect(h.captureRoomSession).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }));
  });

  it("durationSec = 0, если creationTime невалиден (0)", async () => {
    h.readStats.mockResolvedValueOnce({ peak: 1, totalUnique: 1, isPublic: false });
    await post({ event: "room_finished", createdAt: 1700000000n, room: { name: CODE, creationTime: 0n, metadata: "" } });
    expect(h.captureRoomSession).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 0 }));
  });

  it("сбой отправки → ключи статистики НЕ стираем (не теряем данные)", async () => {
    h.readStats.mockResolvedValueOnce({ peak: 2, totalUnique: 2, isPublic: false });
    h.captureRoomSession.mockRejectedValueOnce(new Error("network"));
    const res = await post({ event: "room_finished", createdAt: 1000n, room: { name: CODE, creationTime: 940n, metadata: "" } });
    expect(res.status).toBe(200);
    expect(h.cleanupStats).not.toHaveBeenCalled();
  });

  it("room_finished без участников → событие НЕ шлём, но ключи чистим", async () => {
    h.readStats.mockResolvedValueOnce({ peak: 0, totalUnique: 0, isPublic: false });
    await post({ event: "room_finished", createdAt: 1000n, room: { name: "EMPTY1", creationTime: 990n, metadata: "" } });
    expect(h.captureRoomSession).not.toHaveBeenCalled();
    expect(h.cleanupStats).toHaveBeenCalledWith("EMPTY1");
  });
});

describe("события для админки", () => {
  const ev = async () => {
    const { settleEvents, readEvents } = await import("@/lib/platform/events");
    await settleEvents();
    return (await readEvents(null, 1000)).events;
  };

  it("participant_left → leave с длительностью; room_finished → пик и уникальные", async () => {
    await post({
      event: "participant_left",
      createdAt: 1_000_100n,
      room: lkRoom(),
      participant: { identity: GUEST, joinedAt: 1_000_000n },
    });
    h.readStats.mockResolvedValueOnce({ peak: 3, totalUnique: 4, isPublic: true });
    await post({ event: "room_finished", createdAt: 2000n, room: { name: CODE, creationTime: 1000n } });
    const list = await ev();
    expect(list.find((e) => e.t === "leave")).toMatchObject({ code: CODE, identity: GUEST, durSec: "100" });
    expect(list.find((e) => e.t === "room_finished")).toMatchObject({ peak: "3", unique: "4", durSec: "1000" });
  });

  it("запрет администрации действует и на владельца при прямом подключении", async () => {
    const { adminKick } = await import("@/lib/platform/roomAdmin");
    await adminKick(CODE, HOST, null, "abuse");
    await joined(HOST, "Host");
    const reason = lk.updateCalls.filter((u) => u.identity === HOST).at(-1)?.metadata;
    expect(parseParticipantPublicMeta(reason).removed).toEqual({ reason: "admin_ban" });
  });

  it("показ сверх потолка сервера останавливается; feature screen_share", async () => {
    const { CONFIG_KEY, resetConfigCache } = await import("@/lib/platform/runtimeConfig");
    const { DEFAULT_RUNTIME_CONFIG } = await import("@/lib/api/platform");
    await redis.set(
      CONFIG_KEY,
      JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, limits: { ...DEFAULT_RUNTIME_CONFIG.limits, maxScreenShares: 1 } }),
    );
    resetConfigCache();
    const a = lk.join(CODE, { identity: HOST, name: "Host", permission: { canPublish: true, canPublishSources: [] } });
    const b = lk.join(CODE, { identity: GUEST, name: "Guest", permission: { canPublish: true, canPublishSources: [] } });
    lk.publish(CODE, a.identity, TrackSource.SCREEN_SHARE);
    await post({ event: "track_published", room: lkRoom(), participant: { ...a }, track: { source: TrackSource.SCREEN_SHARE } });
    expect(lk.participants.get(CODE)?.get(HOST)?.tracks).toHaveLength(1);
    lk.publish(CODE, b.identity, TrackSource.SCREEN_SHARE);
    await post({ event: "track_published", room: lkRoom(), participant: { ...b }, track: { source: TrackSource.SCREEN_SHARE } });
    expect(lk.participants.get(CODE)?.get(GUEST)?.tracks).toHaveLength(0);
    expect((await ev()).some((e) => e.t === "feature" && e.name === "screen_share")).toBe(true);
  });
});
