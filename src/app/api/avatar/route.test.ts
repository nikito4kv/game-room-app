// Рисунок Румика для других (R4) на фейках: POST /api/avatar, GET /api/avatar/<id>,
// «сбросить рисунок» во внутреннем API, рисунок в жалобе и в живой картине.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeLiveKit,
  FakeRedis,
  applyTestEnv,
  connectWithToken,
  jsonRequest,
  readResponse,
} from "@/lib/server/testFakes";
import { noisyPng, pngChunk, testPng } from "@/lib/server/testPng";

const h = vi.hoisted(() => ({
  redis: null as unknown,
  livekit: null as unknown,
  consume: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));
vi.mock("@/lib/livekit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/livekit")>()),
  getRoomService: () => h.livekit,
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  consumeLimit: (...args: unknown[]) => h.consume(...args),
  peekLimit: async () => ({ remaining: 20, retryAfterSec: 600 }),
}));

import {
  AVATAR_ATTRIBUTE,
  AVATAR_TTL_DAYS,
  VOICE_ATTRIBUTES,
  parseAvatarAttribute,
  type ApiErrorBody,
  type AvatarResponse,
  type CreateRoomResponse,
  type TokenResponse,
} from "@/lib/api/contract";
import {
  DEFAULT_RUNTIME_CONFIG,
  type AvatarResetResponse,
  type LiveResponse,
  type ReportResponse,
} from "@/lib/api/platform";
import { readEvents, settleEvents } from "@/lib/platform/events";
import { listReports } from "@/lib/platform/reports";
import { CONFIG_KEY, resetConfigCache } from "@/lib/platform/runtimeConfig";
import { avatarLimit, avatarNewIpLimit, avatarNewRoomLimit, avatarReadLimit } from "@/lib/ratelimit";
import { AVATAR_DAY_BUDGET_BYTES, AVATAR_HIDDEN_TTL_SEC, avatarIdOf, checkAvatarPng } from "@/lib/server/avatar";
import { AVATAR_BANNED_MESSAGE } from "@/lib/server/errors";
import { POST as createRoom } from "../rooms/route";
import { POST as getToken } from "../token/route";
import { POST as moderate } from "../moderate/route";
import { POST as voice } from "../voice/route";
import { POST as report } from "../report/route";
import { GET as live } from "../internal/live/route";
import { POST as reset } from "../internal/rooms/[code]/avatar-reset/route";
import { GET as internalAvatar } from "../internal/avatar/[id]/route";
import { POST as post } from "./route";
import { GET as get } from "./[id]/route";

const INTERNAL = "i".repeat(40);

/** FakeRedis + INCRBY (суточный бюджет рисунков): срок ключа сохраняется, как в Redis. */
class AvatarRedis extends FakeRedis {
  async incrby(key: string, by: number) {
    const ttl = await this.pttl(key);
    const next = Number((await this.get(key)) ?? 0) + Number(by);
    await this.set(key, String(next));
    if (ttl > 0) await this.expire(key, Math.ceil(ttl / 1000));
    return next;
  }
}

let redis: AvatarRedis;
let lk: FakeLiveKit;
let code: string;
let hostToken: string;
let guestToken: string;
const device = (n: number) => ({ id: `device${n}`.padEnd(22, "x"), secret: "s".repeat(43) });
const hostId = `u_${device(1).id}`;
const guestId = `u_${device(2).id}`;
const PNG = testPng();
const PNG_ID = avatarIdOf(PNG);
const TTL_SEC = AVATAR_TTL_DAYS * 24 * 3600;

async function enter(name: string, n: number, hostKey?: string): Promise<string> {
  const res = await readResponse<TokenResponse>(
    await getToken(jsonRequest("/api/token", { v: 2, code, name, device: device(n), hostKey })),
  );
  await connectWithToken(lk, res.body.token);
  return res.body.token;
}

const send = (token: string, png: unknown, extra: Record<string, unknown> = {}, ip = "10.0.0.9") =>
  post(jsonRequest("/api/avatar", { code, token, png, ...extra }, { "x-real-ip": ip })).then((r) =>
    readResponse<AvatarResponse & ApiErrorBody>(r),
  );
const b64 = (buf: Buffer) => buf.toString("base64");
const fetchAvatar = (id: string) =>
  get(jsonRequest(`/api/avatar/${id}`, undefined, { "x-real-ip": "10.0.0.7" }), { params: Promise.resolve({ id }) });
const person = (identity: string) => lk.participants.get(code)!.get(identity)!;
const attributeWrites = () => lk.updateCalls.filter((u) => u.attributes !== undefined);
const internalReq = (path: string, body?: unknown) =>
  new Request(`http://app.test/api/internal${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-internal-token": INTERNAL },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const resetReq = (body: Record<string, unknown>) =>
  reset(internalReq(`/rooms/${code}/avatar-reset`, body), { params: Promise.resolve({ code }) });
const setFlag = async (mode: "on" | "off") => {
  await redis.set(CONFIG_KEY, JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, flags: { rumik_share: { mode } } }));
  resetConfigCache();
};

beforeAll(() => {
  applyTestEnv();
  process.env.INTERNAL_API_TOKEN = INTERNAL;
});

beforeEach(async () => {
  vi.useRealTimers();
  redis = new AvatarRedis();
  h.redis = redis;
  lk = new FakeLiveKit();
  h.livekit = lk;
  h.consume.mockReset().mockResolvedValue({ limited: false, remaining: 5 });
  resetConfigCache();
  const created = await readResponse<CreateRoomResponse>(
    await createRoom(jsonRequest("/api/rooms", { title: "Комната" })),
  );
  code = created.body.code;
  hostToken = await enter("Аня", 1, created.body.hostKey);
  guestToken = await enter("Боря", 2);
  lk.updateCalls = [];
});

describe("POST /api/avatar", () => {
  it("кладёт картинку и пишет id в атрибут вызывающего; GET отдаёт её с вечным личным кешем", async () => {
    const res = await send(guestToken, b64(PNG));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: PNG_ID });
    expect(person(guestId).attributes).toEqual({ [AVATAR_ATTRIBUTE]: PNG_ID });
    expect(parseAvatarAttribute(person(guestId).attributes)).toBe(PNG_ID);
    expect(person(hostId).attributes).toEqual({});

    const img = await fetchAvatar(PNG_ID);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    // private: общие кеши по дороге картинку не держат — скрытый рисунок из них не всплывёт.
    expect(img.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("одинаковые картинки — одна запись; каждый POST продлевает срок до 30 дней", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await send(guestToken, b64(PNG));
    expect(redis.ttlSec(`gr:avatar:${PNG_ID}`)).toBe(TTL_SEC);
    vi.setSystemTime(Date.now() + 10 * 24 * 3600 * 1000);
    expect(redis.ttlSec(`gr:avatar:${PNG_ID}`)).toBe(TTL_SEC - 10 * 24 * 3600);
    await send(hostToken, b64(PNG));
    expect(redis.ttlSec(`gr:avatar:${PNG_ID}`)).toBe(TTL_SEC);
    expect(redis.keys().filter((k) => k.startsWith("gr:avatar:"))).toEqual([`gr:avatar:${PNG_ID}`]);
    expect(person(hostId).attributes[AVATAR_ATTRIBUTE]).toBe(PNG_ID);
    // Лимит новых рисунков с адреса тратит только первый, повтор — нет.
    expect(h.consume.mock.calls.filter(([l]) => l === avatarNewIpLimit())).toEqual([[avatarNewIpLimit(), "10.0.0.9"]]);
    // Через 30 дней без входов запись стирается сама.
    vi.setSystemTime(Date.now() + TTL_SEC * 1000 + 1000);
    expect((await fetchAvatar(PNG_ID)).status).toBe(404);
  });

  it("png: null снимает атрибут; другие атрибуты (голос) не трогает", async () => {
    await voice(jsonRequest("/api/voice", { code, token: guestToken, deafened: true, ptt: false }));
    await send(guestToken, b64(PNG));
    const off = await send(guestToken, null);
    expect(off.body).toEqual({ ok: true, id: null });
    expect(person(guestId).attributes).toEqual({ [VOICE_ATTRIBUTES.deafened]: "1" });
  });

  it("кому писать — только из подписи токена; metadata и права не меняются", async () => {
    await moderate(jsonRequest("/api/moderate", { code, token: hostToken, action: "mute", target: guestId }));
    const before = { metadata: person(guestId).metadata, permission: { ...person(guestId).permission } };
    await send(guestToken, b64(PNG), { identity: hostId });
    expect(person(hostId).attributes).toEqual({});
    expect(person(guestId).attributes[AVATAR_ATTRIBUTE]).toBe(PNG_ID);
    expect(person(guestId).metadata).toBe(before.metadata);
    expect(person(guestId).permission).toEqual(before.permission);
    expect(attributeWrites().at(-1)).toMatchObject({ metadata: undefined, permission: undefined });
  });

  it("не PNG, не тот размер, анимация, слишком большое тело — AVATAR_INVALID; без поля — BAD_REQUEST", async () => {
    // APNG с настоящей контрольной суммой: отказ именно за анимацию, а не за битый чанк.
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    const animated = testPng({ before: [pngChunk("acTL", actl)] });
    expect(checkAvatarPng(animated)).toEqual({ ok: false, problem: "animated" });
    const bad = [b64(Buffer.from("GIF89a")), b64(testPng({ width: 572, height: 480 })), b64(animated), "@".repeat(100)];
    for (const png of bad) {
      const res = await send(guestToken, png);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AVATAR_INVALID");
    }
    const huge = await post(
      new Request("http://app.test/api/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, token: guestToken, png: "A".repeat(200_000) }),
      }),
    );
    expect(((await huge.json()) as ApiErrorBody).error.code).toBe("AVATAR_INVALID");
    expect((await send(guestToken, undefined)).body.error.code).toBe("BAD_REQUEST");
    const notJson = await post(
      new Request("http://app.test/api/avatar", { method: "POST", body: "{", headers: { "content-type": "application/json" } }),
    );
    expect(notJson.status).toBe(400);
    expect(attributeWrites()).toEqual([]);
    expect(redis.keys().filter((k) => k.startsWith("gr:avatar"))).toEqual([]);
  });

  it("чужой токен — UNAUTHORIZED; не в комнате — NOT_IN_ROOM и ничего не хранится", async () => {
    const forged = await send("подделка", b64(PNG));
    expect(forged.status).toBe(401);
    lk.leave(code, guestId);
    const gone = await send(guestToken, b64(PNG));
    expect(gone.status).toBe(403);
    expect(gone.body.error.code).toBe("NOT_IN_ROOM");
    expect(redis.keys().filter((k) => k.startsWith("gr:avatar"))).toEqual([]);
    expect((await send(guestToken, null)).body.error.code).toBe("NOT_IN_ROOM");
  });

  it("лимит на участника и на новые рисунки с адреса — RATE_LIMITED с retryAfterSec", async () => {
    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 4 });
    const res = await send(guestToken, b64(PNG));
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 4 });
    expect(h.consume).toHaveBeenLastCalledWith(avatarLimit(), `${code}:${guestId}`);

    h.consume.mockImplementation(async (l: unknown) =>
      l === avatarNewIpLimit() ? { limited: true, retryAfterSec: 300 } : { limited: false, remaining: 3 },
    );
    const byIp = await send(guestToken, b64(PNG));
    expect(byIp.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 300 });
    expect(attributeWrites()).toEqual([]);
  });

  it("IPv6 считается по /64: смена адреса внутри сети лимит не обходит", async () => {
    await send(guestToken, b64(PNG), {}, "2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    await send(hostToken, b64(testPng({ fill: [1, 2, 3] })), {}, "2001:DB8:1:2::5");
    const keys = h.consume.mock.calls.filter(([l]) => l === avatarNewIpLimit()).map(([, k]) => k);
    expect(keys).toEqual(["2001:db8:1:2::/64", "2001:db8:1:2::/64"]);
    await get(jsonRequest(`/api/avatar/${PNG_ID}`, undefined, { "x-real-ip": "2001:db8:1:2::77" }), {
      params: Promise.resolve({ id: PNG_ID }),
    });
    expect(h.consume).toHaveBeenLastCalledWith(avatarReadLimit(), "2001:db8:1:2::/64");
  });

  it("лимит новых рисунков на комнату — RATE_LIMITED; повтор лежащего рисунка его не тратит", async () => {
    await send(guestToken, b64(PNG));
    expect(h.consume).toHaveBeenCalledWith(avatarNewRoomLimit(), code);
    h.consume.mockImplementation(async (l: unknown) =>
      l === avatarNewRoomLimit() ? { limited: true, retryAfterSec: 120 } : { limited: false, remaining: 3 },
    );
    const res = await send(hostToken, b64(testPng({ fill: [0, 200, 0] })));
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 120 });
    expect(person(hostId).attributes).toEqual({});
    // Тот же рисунок, что уже лежит, — проходит: место он не занимает.
    expect((await send(hostToken, b64(PNG))).status).toBe(200);
  });

  it("суточный бюджет на весь сайт: сверх — AVATAR_LIMIT, ничего не хранится; назавтра снова можно", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    const dayKey = "gr:avatarday:2026-10-06";
    await send(guestToken, b64(PNG));
    expect(Number(await redis.get(dayKey))).toBe(PNG.length);
    expect(redis.ttlSec(dayKey)).toBeGreaterThan(24 * 3600);
    // Почти всё потрачено: новый рисунок не влезает.
    await redis.set(dayKey, String(AVATAR_DAY_BUDGET_BYTES - 10), { ex: 2 * 24 * 3600 });
    const other = testPng({ fill: [10, 20, 30] });
    const res = await send(hostToken, b64(other));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("AVATAR_LIMIT");
    expect("retryAfterSec" in res.body.error).toBe(false);
    expect(await redis.get(`gr:avatar:${avatarIdOf(other)}`)).toBeNull();
    expect(person(hostId).attributes).toEqual({});
    // Уже лежащий рисунок бюджет не тратит.
    expect((await send(hostToken, b64(PNG))).status).toBe(200);
    // Новые сутки (UTC) — новый счётчик.
    vi.setSystemTime(new Date("2026-10-07T00:00:01Z"));
    expect((await send(hostToken, b64(other))).status).toBe(200);
    expect(Number(await redis.get("gr:avatarday:2026-10-07"))).toBe(other.length);
  });

  it("шум, который не сжимается, — AVATAR_INVALID (потолок AVATAR_MAX_BYTES)", async () => {
    const res = await send(guestToken, b64(noisyPng()));
    expect(res.body.error.code).toBe("AVATAR_INVALID");
    expect(redis.keys().filter((k) => k.startsWith("gr:avatar"))).toEqual([]);
  });

  it("флаг rumik_share выключен — FEATURE_DISABLED, и GET картинки не отдаёт", async () => {
    await send(guestToken, b64(PNG));
    await setFlag("off");
    const res = await send(hostToken, b64(PNG));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect((await fetchAvatar(PNG_ID)).status).toBe(404);
    await setFlag("on");
    expect((await fetchAvatar(PNG_ID)).status).toBe(200);
  });

  it("LiveKit не отвечает — SERVICE_UNAVAILABLE", async () => {
    vi.spyOn(lk, "updateParticipant").mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await send(guestToken, null);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("GET /api/avatar/<id>", () => {
  it("кривой id и неизвестный рисунок — 404 без кеша; лимит по адресу — 429", async () => {
    for (const id of ["short", "../../../etc/passwd", "A".repeat(17)]) {
      const res = await fetchAvatar(id);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const missing = await fetchAvatar("AAAAAAAAAAAAAAAA");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiErrorBody).error.code).toBe("AVATAR_NOT_FOUND");

    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 20 });
    const limited = await fetchAvatar(PNG_ID);
    expect(limited.status).toBe(429);
    expect(h.consume).toHaveBeenLastCalledWith(avatarReadLimit(), "10.0.0.7");
  });
});

describe("сбросить рисунок (внутренний API)", () => {
  it("снимает атрибут, скрывает картинку, тот же рисунок больше не принять; событие admin", async () => {
    await send(guestToken, b64(PNG));
    const res = await readResponse<AvatarResetResponse>(await resetReq({ identity: guestId, reason: "abuse" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, avatarId: PNG_ID, cleared: true, hidden: [PNG_ID] });
    expect(person(guestId).attributes).toEqual({});
    expect((await fetchAvatar(PNG_ID)).status).toBe(404);
    expect(redis.ttlSec(`gr:avatarblock:${PNG_ID}`)).toBe(TTL_SEC);

    const again = await send(guestToken, b64(PNG));
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe("AVATAR_BLOCKED");
    // И с другого устройства тот же рисунок не пройдёт.
    expect((await send(hostToken, b64(PNG))).body.error.code).toBe("AVATAR_BLOCKED");
    // Другой рисунок у другого человека — можно.
    expect((await send(hostToken, b64(testPng({ fill: [0, 120, 255] })))).status).toBe(200);

    await settleEvents();
    const events = (await readEvents(null, 100)).events;
    expect(events.some((e) => e.t === "admin" && e.action === "avatar_reset" && e.identity === guestId && e.reason === "abuse")).toBe(true);
  });

  it("человек уже ушёл — сбрасывается рисунок из запроса (из жалобы)", async () => {
    await send(guestToken, b64(PNG));
    lk.leave(code, guestId);
    const res = await readResponse<AvatarResetResponse>(
      await resetReq({ identity: guestId, avatarId: PNG_ID, reason: "rules" }),
    );
    expect(res.body).toEqual({ ok: true, avatarId: PNG_ID, cleared: false, hidden: [PNG_ID] });
    expect((await fetchAvatar(PNG_ID)).status).toBe(404);
  });

  it("картинка не удаляется, а прячется: публично 404, внутренний API отдаёт её для жалобы и журнала", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await send(guestToken, b64(PNG));
    await resetReq({ identity: guestId, reason: "abuse" });
    expect((await fetchAvatar(PNG_ID)).status).toBe(404);
    expect(await redis.get(`gr:avatar:${PNG_ID}`)).toBeNull();
    expect(redis.ttlSec(`gr:avatarhidden:${PNG_ID}`)).toBe(AVATAR_HIDDEN_TTL_SEC);
    const img = await internalAvatar(internalReq(`/avatar/${PNG_ID}`), { params: Promise.resolve({ id: PNG_ID }) });
    expect(img.status).toBe(200);
    expect(img.headers.get("x-avatar-hidden")).toBe("1");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    // Живёт, как жалоба: потом пропадает и для админки.
    vi.setSystemTime(Date.now() + AVATAR_HIDDEN_TTL_SEC * 1000 + 1000);
    const gone = await internalAvatar(internalReq(`/avatar/${PNG_ID}`), { params: Promise.resolve({ id: PNG_ID }) });
    expect(gone.status).toBe(404);
  });

  it("карточка из старого снимка: скрываются и текущий рисунок (атрибут читает сервер), и тот, что видела админка", async () => {
    const seen = testPng({ fill: [200, 0, 0] });
    await send(guestToken, b64(seen));
    // Пока админка смотрела снимок, человек сменил рисунок.
    await send(guestToken, b64(PNG));
    const res = await readResponse<AvatarResetResponse>(
      await resetReq({ identity: guestId, avatarId: avatarIdOf(seen), reason: "abuse" }),
    );
    expect(res.body).toEqual({ ok: true, avatarId: PNG_ID, cleared: true, hidden: [PNG_ID, avatarIdOf(seen)] });
    expect(person(guestId).attributes).toEqual({});
    expect((await fetchAvatar(PNG_ID)).status).toBe(404);
    expect((await fetchAvatar(avatarIdOf(seen))).status).toBe(404);
  });

  it("Server SDK отдаёт ключ атрибута в camelCase (avatarId) — сброс его видит", async () => {
    await send(guestToken, b64(PNG));
    person(guestId).attributes = { avatarId: PNG_ID };
    const res = await readResponse<AvatarResetResponse>(await resetReq({ identity: guestId, reason: "rules" }));
    expect(res.body).toMatchObject({ ok: true, avatarId: PNG_ID, cleared: true });
    expect(attributeWrites().at(-1)?.attributes).toEqual({ [AVATAR_ATTRIBUTE]: "" });
  });

  it("после сброса новые рисунки этого человека в комнате не принимаются (изменённый на пиксель — тоже)", async () => {
    await send(guestToken, b64(PNG));
    await resetReq({ identity: guestId, reason: "abuse" });
    const tweaked = testPng({ fill: [220, 60, 91] });
    const res = await send(guestToken, b64(tweaked));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "AVATAR_BLOCKED", message: AVATAR_BANNED_MESSAGE });
    expect(person(guestId).attributes).toEqual({});
    expect(await redis.get(`gr:avatar:${avatarIdOf(tweaked)}`)).toBeNull();
    // Снять свой атрибут можно всегда.
    expect((await send(guestToken, null)).status).toBe(200);
    // Сам рисунок не скрыт: у другого человека он проходит.
    expect((await send(hostToken, b64(tweaked))).status).toBe(200);
    // Запрет живёт, пока жива комната (48 ч), а не вечно.
    expect(redis.ttlSec(`gr:avatarban:${code}:${guestId}`)).toBe(48 * 3600);
  });

  it("причина обязательна, рисунка нет — 404 no_avatar, кривой id — 400; без токена — 401", async () => {
    await send(guestToken, b64(PNG));
    expect((await resetReq({ identity: guestId })).status).toBe(400);
    expect((await resetReq({ identity: hostId, reason: "test" })).status).toBe(404);
    expect((await resetReq({ identity: guestId, avatarId: "../x", reason: "test" })).status).toBe(400);
    const anon = await reset(
      new Request(`http://app.test/api/internal/rooms/${code}/avatar-reset`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ code }) },
    );
    expect(anon.status).toBe(401);
    expect(person(guestId).attributes[AVATAR_ATTRIBUTE]).toBe(PNG_ID);
  });

  it("админка видит рисунок: в живой картине (avatarId) и картинкой по внутреннему адресу", async () => {
    await send(guestToken, b64(PNG));
    const snap = await readResponse<LiveResponse>(await live(internalReq("/live"), undefined));
    const people = snap.body.rooms[0]!.participants;
    expect(people.find((p) => p.identity === guestId)?.avatarId).toBe(PNG_ID);
    expect(people.find((p) => p.identity === hostId)?.avatarId).toBeNull();

    const img = await internalAvatar(internalReq(`/avatar/${PNG_ID}`), { params: Promise.resolve({ id: PNG_ID }) });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toBe("no-store");
    const anon = await internalAvatar(new Request(`http://app.test/api/internal/avatar/${PNG_ID}`), {
      params: Promise.resolve({ id: PNG_ID }),
    });
    expect(anon.status).toBe(401);
  });

  it("жалоба запоминает рисунок того, на кого жалуются", async () => {
    await send(guestToken, b64(PNG));
    const res = await readResponse<ReportResponse>(
      await report(jsonRequest("/api/report", { code, token: hostToken, targetIdentity: guestId, reason: "nsfw" })),
    );
    expect(res.status).toBe(200);
    const stored = (await listReports({ status: "all" })).reports.find((r) => r.id === res.body.id);
    expect(stored?.targetAvatarId).toBe(PNG_ID);
  });
});
