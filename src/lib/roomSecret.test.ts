import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "@/lib/server/testFakes";

const fake = vi.hoisted(() => ({ redis: null as unknown }));
vi.mock("./redis", () => ({
  getRedisRaw: () => fake.redis,
  getRedis: () => fake.redis,
}));

import { DEFAULT_ROOM_SETTINGS, type ChatMessage } from "@/lib/api/contract";
import {
  ROOM_FINISHED_GRACE_SECONDS,
  ROOM_STATE_TTL_SECONDS,
  appendChatMessage,
  bindSeat,
  blockAfterKick,
  casHost,
  createRoomState,
  expireRoomStateSoon,
  loadAuth,
  loadBans,
  loadChatHistory,
  loadJoinSnapshot,
  loadRoomFlags,
  loadRoomMeta,
  markHostLeft,
  loadHostLeftAt,
  rememberName,
  setParticipantFlag,
  setPasswordHash,
  touchRoomState,
  updateRoomMeta,
  type StoredRoomMeta,
} from "@/lib/roomSecret";

const CODE = "ABC123";
let redis: FakeRedis;

const meta: Omit<StoredRoomMeta, "rev"> = {
  title: "Комната",
  isPublic: false,
  createdAt: 1000,
  hostIdentity: null,
  hostName: null,
  ownerIdentity: null,
  locked: false,
  hasPassword: false,
  settings: DEFAULT_ROOM_SETTINGS,
  badge: null,
  keyId: null,
  maxParticipants: null,
};
const auth = { passwordHash: null, hostKeyHash: "k:h" };

beforeEach(() => {
  redis = new FakeRedis();
  fake.redis = redis;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("создание и описание", () => {
  it("createRoomState сохраняет описание и auth на 48 ч", async () => {
    expect(await createRoomState(CODE, { meta, auth })).toBe(true);
    expect(await loadRoomMeta(CODE)).toEqual({ ...meta, rev: 1 });
    expect(await loadAuth(CODE)).toEqual(auth);
    expect(redis.ttlSec(`room:${CODE}:meta`)).toBe(ROOM_STATE_TTL_SECONDS);
    expect(redis.ttlSec(`room:${CODE}:auth`)).toBe(ROOM_STATE_TTL_SECONDS);
  });

  it("код уже занят — false и ничего не перетирается", async () => {
    await createRoomState(CODE, { meta, auth });
    expect(await createRoomState(CODE, { meta: { ...meta, title: "Другая" }, auth })).toBe(false);
    expect((await loadRoomMeta(CODE))?.title).toBe("Комната");
  });

  it("остатки прежней комнаты с тем же кодом стираются", async () => {
    await redis.sadd(`room:${CODE}:banned`, "u_old");
    await createRoomState(CODE, { meta, auth });
    expect((await loadJoinSnapshot(CODE, "u_old")).banned).toBe(false);
  });

  it("updateRoomMeta меняет поля и наращивает rev; без комнаты — false", async () => {
    await createRoomState(CODE, { meta, auth });
    expect(await updateRoomMeta(CODE, { locked: true, screen: "host", isPublic: true })).toBe(true);
    const m = await loadRoomMeta(CODE);
    expect(m).toMatchObject({ locked: true, isPublic: true, settings: { screen: "host", chat: "all" }, rev: 2 });
    expect(await updateRoomMeta("NOPE00", { locked: true })).toBe(false);
    expect(await loadRoomMeta("NOPE00")).toBeNull();
  });

  it("setPasswordHash: задать и снять, hasPassword следует за ним", async () => {
    await createRoomState(CODE, { meta, auth });
    await setPasswordHash(CODE, "s:h");
    expect((await loadAuth(CODE))?.passwordHash).toBe("s:h");
    expect((await loadRoomMeta(CODE))?.hasPassword).toBe(true);
    await setPasswordHash(CODE, null);
    expect((await loadAuth(CODE))?.passwordHash).toBeNull();
    expect((await loadRoomMeta(CODE))?.hasPassword).toBe(false);
  });
});

describe("casHost", () => {
  beforeEach(async () => {
    await createRoomState(CODE, { meta, auth });
  });

  it("меняет хоста только при ожидаемом текущем", async () => {
    expect(await casHost(CODE, null, { identity: "u_a", name: "Аня" })).toBe("ok");
    expect(await casHost(CODE, null, { identity: "u_b", name: "Боря" })).toBe("conflict");
    expect(await casHost(CODE, "u_a", { identity: "u_b", name: "Боря" })).toBe("ok");
    expect(await loadRoomMeta(CODE)).toMatchObject({ hostIdentity: "u_b", hostName: "Боря" });
    expect(await casHost("NOPE00", null, { identity: "u_a", name: "Аня" })).toBe("missing");
  });

  it("с нового хоста снимаются мьют и запрет чата, отметка ухода стирается", async () => {
    await setParticipantFlag(CODE, "muted", "u_b", true);
    await setParticipantFlag(CODE, "chatMuted", "u_b", true);
    await markHostLeft(CODE, 5);
    await casHost(CODE, null, { identity: "u_b", name: "Боря" });
    const snap = await loadJoinSnapshot(CODE, "u_b");
    expect(snap.forceMuted).toBe(false);
    expect(snap.chatMuted).toBe(false);
    expect(await loadHostLeftAt(CODE)).toBeNull();
  });
});

describe("места (TOFU)", () => {
  it("первый закрепляет, второй получает сохранённый хэш", async () => {
    expect(await bindSeat(CODE, "u_a", "hash1")).toEqual({ bound: true });
    expect(await bindSeat(CODE, "u_a", "hash2")).toEqual({ bound: false, storedHash: "hash1" });
    expect((await loadJoinSnapshot(CODE, "u_a")).seatHash).toBe("hash1");
  });
});

describe("снимок входа", () => {
  it("собирает флаги участника одним запросом", async () => {
    await createRoomState(CODE, { meta, auth });
    await setParticipantFlag(CODE, "banned", "u_a", true);
    await setParticipantFlag(CODE, "members", "u_a", true);
    await setParticipantFlag(CODE, "muted", "u_a", true);
    await setParticipantFlag(CODE, "screenAllowed", "u_a", true);
    const snap = await loadJoinSnapshot(CODE, "u_a");
    expect(snap).toMatchObject({
      auth,
      banned: true,
      member: true,
      forceMuted: true,
      chatMuted: false,
      screenAllowed: true,
      kickRemainingSec: 0,
    });
    expect(snap.meta?.title).toBe("Комната");
  });

  it("нет комнаты — пустой снимок", async () => {
    const snap = await loadJoinSnapshot("NOPE00", "u_a");
    expect(snap.meta).toBeNull();
    expect(snap.auth).toBeNull();
  });
});

describe("кик с тайм-аутом", () => {
  it("блок действует 5 минут и сам истекает", async () => {
    await blockAfterKick(CODE, "u_a", 300);
    expect((await loadJoinSnapshot(CODE, "u_a")).kickRemainingSec).toBe(300);
    vi.setSystemTime(Date.now() + 120_000);
    expect((await loadJoinSnapshot(CODE, "u_a")).kickRemainingSec).toBe(180);
    vi.setSystemTime(Date.now() + 181_000);
    expect((await loadJoinSnapshot(CODE, "u_a")).kickRemainingSec).toBe(0);
  });
});

describe("флаги, имена, баны", () => {
  it("loadRoomFlags отдаёт множества флагов", async () => {
    await createRoomState(CODE, { meta, auth });
    await setParticipantFlag(CODE, "muted", "u_a", true);
    await setParticipantFlag(CODE, "chatMuted", "u_b", true);
    await setParticipantFlag(CODE, "muted", "u_a", false);
    const { meta: m, flags } = await loadRoomFlags(CODE);
    expect(m?.title).toBe("Комната");
    expect([...flags.muted]).toEqual([]);
    expect([...flags.chatMuted]).toEqual(["u_b"]);
  });

  it("список банов с последними никами; неизвестный — по identity", async () => {
    await rememberName(CODE, "u_a", "Аня");
    await setParticipantFlag(CODE, "banned", "u_a", true);
    await setParticipantFlag(CODE, "banned", "u_x", true);
    expect(await loadBans(CODE)).toEqual([
      { identity: "u_a", name: "Аня" },
      { identity: "u_x", name: "u_x" },
    ]);
  });
});

describe("чат", () => {
  const msg = (i: number): ChatMessage => ({
    id: `m${i}`,
    ts: i,
    from: { identity: "u_a", name: "Аня" },
    text: `сообщение ${i}`,
  });

  it("хранит последние 100, отдаёт от старых к новым", async () => {
    for (let i = 1; i <= 105; i++) await appendChatMessage(CODE, msg(i));
    const history = await loadChatHistory(CODE);
    expect(history).toHaveLength(100);
    expect(history[0].id).toBe("m6");
    expect(history[99].id).toBe("m105");
    expect(redis.ttlSec(`room:${CODE}:chat`)).toBe(ROOM_STATE_TTL_SECONDS);
  });

  it("битые записи пропускаются", async () => {
    await redis.lpush(`room:${CODE}:chat`, "{не json", JSON.stringify(msg(1)));
    expect((await loadChatHistory(CODE)).map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("сроки жизни", () => {
  it("touch продлевает до 48 ч, после room_finished — 15 минут", async () => {
    await createRoomState(CODE, { meta, auth });
    await setParticipantFlag(CODE, "banned", "u_a", true);
    vi.setSystemTime(Date.now() + 3_600_000);
    expect(redis.ttlSec(`room:${CODE}:meta`)).toBe(ROOM_STATE_TTL_SECONDS - 3600);
    await touchRoomState(CODE);
    expect(redis.ttlSec(`room:${CODE}:meta`)).toBe(ROOM_STATE_TTL_SECONDS);
    await expireRoomStateSoon(CODE);
    expect(redis.ttlSec(`room:${CODE}:meta`)).toBe(ROOM_FINISHED_GRACE_SECONDS);
    expect(redis.ttlSec(`room:${CODE}:banned`)).toBe(ROOM_FINISHED_GRACE_SECONDS);
    vi.setSystemTime(Date.now() + ROOM_FINISHED_GRACE_SECONDS * 1000 + 1);
    expect(await loadRoomMeta(CODE)).toBeNull();
  });

  it("markHostLeft с onlyIfMissing не сдвигает идущий отсчёт", async () => {
    await markHostLeft(CODE, 100);
    await markHostLeft(CODE, 200, true);
    expect(await loadHostLeftAt(CODE)).toBe(100);
    await markHostLeft(CODE, 300);
    expect(await loadHostLeftAt(CODE)).toBe(300);
  });
});
