// Внутренний API на фейках: живая картина, закрытие, кик администрации, сообщение,
// чат по причине, конфиг, блокировки, события.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackSource } from "livekit-server-sdk";
import {
  FakeLiveKit,
  FakeRedis,
  applyTestEnv,
  connectWithToken,
  jsonRequest,
  readResponse,
} from "@/lib/server/testFakes";

const h = vi.hoisted(() => ({ redis: null as unknown, livekit: null as unknown }));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));
vi.mock("@/lib/livekit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/livekit")>()),
  getRoomService: () => h.livekit,
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  consumeLimit: async () => ({ limited: false, remaining: 5 }),
  peekLimit: async () => ({ remaining: 20, retryAfterSec: 600 }),
}));

import type { CreateRoomResponse, ParticipantPublicMeta, TokenResponse } from "@/lib/api/contract";
import type { EventsResponse, LiveResponse, RuntimeConfig } from "@/lib/api/platform";
import { resetConfigCache } from "@/lib/platform/runtimeConfig";
import { settleEvents } from "@/lib/platform/events";
import { POST as createRoom } from "../rooms/route";
import { POST as getToken } from "../token/route";
import { GET as live } from "./live/route";
import { POST as close } from "./rooms/[code]/close/route";
import { POST as kick } from "./rooms/[code]/kick/route";
import { POST as message } from "./rooms/[code]/message/route";
import { GET as chat } from "./rooms/[code]/chat/route";
import { GET as configGet, PUT as configPut } from "./config/route";
import { DELETE as unblock, POST as block } from "./blocks/route";
import { GET as events } from "./events/route";

const TOKEN = "i".repeat(40);
const auth = { "x-internal-token": TOKEN };
const device = (n: number) => ({ id: `device${n}`.padEnd(22, "x"), secret: "s".repeat(43) });
const idOf = (n: number) => `u_${device(n).id}`;

let lk: FakeLiveKit;
let code: string;
let hostKey: string;
const params = (c: string) => ({ params: Promise.resolve({ code: c }) });

async function enter(name: string, n: number, extra: Record<string, unknown> = {}) {
  return readResponse<TokenResponse & { error?: { code: string; message: string } }>(
    await getToken(
      jsonRequest("/api/token", { v: 2, code, name, device: device(n), ...extra }, { "x-real-ip": `10.0.0.${n}` }),
    ),
  );
}
const internalReq = (path: string, body?: unknown, method?: string) =>
  new Request(`http://app.test/api/internal${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(() => {
  applyTestEnv();
  process.env.INTERNAL_API_TOKEN = TOKEN;
});

beforeEach(async () => {
  h.redis = new FakeRedis();
  lk = new FakeLiveKit();
  h.livekit = lk;
  resetConfigCache();
  const created = await readResponse<CreateRoomResponse>(await createRoom(jsonRequest("/api/rooms", { title: "Комната" })));
  code = created.body.code;
  hostKey = created.body.hostKey;
  await connectWithToken(lk, (await enter("Аня", 1, { hostKey })).body.token);
  await connectWithToken(lk, (await enter("Боря", 2)).body.token);
});

describe("доступ", () => {
  it("без токена — 401", async () => {
    const res = await live(new Request("http://app.test/api/internal/live"), undefined);
    expect(res.status).toBe(401);
  });
});

describe("живая картина", () => {
  it("комнаты, люди, показы экрана и оценка зрителей", async () => {
    lk.publish(code, idOf(2), TrackSource.SCREEN_SHARE);
    lk.publish(code, idOf(1), TrackSource.MICROPHONE);
    const { status, body } = await readResponse<LiveResponse>(await live(internalReq("/live"), undefined));
    expect(status).toBe(200);
    expect(body.totals).toEqual({ rooms: 1, participants: 2, screenShares: 1, screenViewers: 1 });
    const room = body.rooms[0]!;
    expect(room).toMatchObject({ code, title: "Комната", maxParticipants: 10, badge: null, keyId: null });
    const anya = room.participants.find((p) => p.identity === idOf(1));
    expect(anya).toMatchObject({ isHost: true, isOwner: true, micOn: true, screenSharing: false });
    expect(room.participants.find((p) => p.identity === idOf(2))?.screenSharing).toBe(true);
  });
});

describe("действия над комнатой", () => {
  it("закрыть: причина обязательна; всем admin_close, комната удалена, вход закрыт", async () => {
    expect((await close(internalReq(`/rooms/${code}/close`, {}), params(code))).status).toBe(400);
    const res = await close(
      internalReq(`/rooms/${code}/close`, { reason: "abuse", message: "Комната закрыта за оскорбления" }),
      params(code),
    );
    expect(res.status).toBe(200);
    // Причина записана в metadata каждого перед отключением.
    const reasons = lk.updateCalls
      .filter((c) => c.metadata?.includes("removed"))
      .map((c) => (JSON.parse(c.metadata!) as ParticipantPublicMeta).removed?.reason);
    expect(reasons).toEqual(["admin_close", "admin_close"]);
    expect(lk.rooms.has(code)).toBe(false);
    // Системное сообщение ушло в чат.
    expect(lk.sentData[0]?.payload).toMatchObject({ system: true, from: { name: "Администрация" } });
    const again = await enter("Аня", 1, { hostKey });
    expect(again.status).toBe(403);
    expect(again.body.error).toMatchObject({ code: "ROOM_CLOSED", message: "Комната закрыта за оскорбления" });
    await settleEvents();
    const ev = await readResponse<EventsResponse>(await events(internalReq("/events?after=0&count=100"), undefined));
    expect(ev.body.events.some((e) => e.t === "admin" && e.action === "close" && e.reason === "abuse")).toBe(true);
  });

  it("закрыть несуществующую или битую комнату — 404/400, отметки нет", async () => {
    const r1 = await close(internalReq("/rooms/UNDEFINED/close", { reason: "test" }), params("undefined"));
    expect(r1.status).toBe(404);
    expect(await (h.redis as FakeRedis).get("gr:closed:UNDEFINED")).toBeNull();
    const r2 = await close(internalReq("/rooms/x/close", { reason: "test" }), params("../x"));
    expect(r2.status).toBe(400);
  });

  it("выгнать на время — admin_kick и запрет входа даже владельцу; бан — admin_ban", async () => {
    const res = await kick(
      internalReq(`/rooms/${code}/kick`, { identity: idOf(1), minutes: 5, reason: "rules" }),
      params(code),
    );
    expect(res.status).toBe(200);
    const meta = JSON.parse(lk.updateCalls.at(-1)!.metadata!) as ParticipantPublicMeta;
    expect(meta.removed).toEqual({ reason: "admin_kick", retryAfterSec: 300 });
    const back = await enter("Аня", 1, { hostKey });
    expect(back.body.error?.code).toBe("KICKED");
    expect(back.body.error?.message).toContain("Администрация");

    await kick(internalReq(`/rooms/${code}/kick`, { identity: idOf(2), minutes: null, reason: "spam" }), params(code));
    expect((JSON.parse(lk.updateCalls.at(-1)!.metadata!) as ParticipantPublicMeta).removed).toEqual({ reason: "admin_ban" });
    expect((await enter("Боря", 2)).body.error?.code).toBe("BANNED");
  });

  it("сообщение в чат и чтение чата только с причиной", async () => {
    await message(internalReq(`/rooms/${code}/message`, { text: "Перезапуск через 5 минут" }), params(code));
    expect(lk.sentData.at(-1)?.payload).toMatchObject({ text: "Перезапуск через 5 минут", system: true });
    expect((await chat(internalReq(`/rooms/${code}/chat`), params(code))).status).toBe(400);
    const read = await readResponse<{ messages: { name: string; text: string }[] }>(
      await chat(internalReq(`/rooms/${code}/chat?reason=abuse`), params(code)),
    );
    expect(read.body.messages).toEqual([expect.objectContaining({ name: "Администрация", text: "Перезапуск через 5 минут" })]);
  });
});

describe("конфиг и блокировки действуют на сайт", () => {
  it("режим обслуживания «вход закрыт»: новых не пускает, «своих» — пускает", async () => {
    const cur = await readResponse<RuntimeConfig>(await configGet(internalReq("/config"), undefined));
    const { rev, updatedAt: _u, ...config } = cur.body;
    void _u;
    config.maintenance = { enabled: true, message: "Техработы", blockNewRooms: true, blockJoins: true };
    const put = await configPut(internalReq("/config", { config, expectedRev: rev }, "PUT"), undefined);
    expect(put.status).toBe(200);
    resetConfigCache();
    expect((await enter("Вова", 3)).body.error).toMatchObject({ code: "MAINTENANCE", message: "Техработы" });
    expect((await enter("Боря", 2)).status).toBe(200);
    const room = await readResponse<{ error: { code: string } }>(await createRoom(jsonRequest("/api/rooms", { title: "x" })));
    expect(room.body.error.code).toBe("MAINTENANCE");
    // Устаревшая ревизия — конфликт.
    expect((await configPut(internalReq("/config", { config, expectedRev: rev }, "PUT"), undefined)).status).toBe(409);
  });

  it("блок адреса: вход BLOCKED и сигнал blocked_attempt; снятие возвращает вход", async () => {
    await block(internalReq("/blocks", { kind: "ip", value: "10.0.0.3", reason: "spam", minutes: null }), undefined);
    expect((await enter("Вова", 3)).body.error?.code).toBe("BLOCKED");
    await settleEvents();
    const ev = await readResponse<EventsResponse>(await events(internalReq("/events?after=0&count=500"), undefined));
    expect(ev.body.events.some((e) => e.t === "signal" && e.kind === "blocked_attempt" && e.ip === "10.0.0.3")).toBe(true);
    expect(ev.body.events.some((e) => e.t === "join_fail" && e.reason === "BLOCKED")).toBe(true);
    await unblock(internalReq("/blocks?kind=ip&value=10.0.0.3", undefined, "DELETE"), undefined);
    expect((await enter("Вова", 3)).status).toBe(200);
  });

  it("блок IP «по участнику»: адрес из памяти входа, в ответе его нет", async () => {
    const unknown = await block(
      internalReq("/blocks", { kind: "ip", value: "", fromParticipant: { code, identity: "u_nobodyxx" }, reason: "abuse", minutes: 60 }),
      undefined,
    );
    expect(unknown.status).toBe(404);
    const res = await block(
      internalReq("/blocks", { kind: "ip", value: "", fromParticipant: { code, identity: idOf(2) }, reason: "abuse", minutes: 60 }),
      undefined,
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("10.0.0.2");
    expect(JSON.parse(text).block.value).toBe(`участник ${idOf(2)} в ${code}`);
    expect((await enter("Боря", 2)).body.error?.code).toBe("BLOCKED");
    // С другого устройства, но с того же адреса — тоже.
    const sameIp = await readResponse<{ error: { code: string } }>(
      await getToken(jsonRequest("/api/token", { v: 2, code, name: "Гриша", device: device(9) }, { "x-real-ip": "10.0.0.2" })),
    );
    expect(sameIp.body.error.code).toBe("BLOCKED");
  });

  it("флаг screen_share выключен — в токене нет права на экран", async () => {
    const cur = await readResponse<RuntimeConfig>(await configGet(internalReq("/config"), undefined));
    const { rev, updatedAt: _u, ...config } = cur.body;
    void _u;
    config.flags = { screen_share: { mode: "off" } };
    await configPut(internalReq("/config", { config, expectedRev: rev }, "PUT"), undefined);
    const p = await connectWithToken(lk, (await enter("Вова", 3)).body.token);
    expect(p.permission.canPublishSources).not.toContain(TrackSource.SCREEN_SHARE);
    expect(lk.publish(code, idOf(3), TrackSource.SCREEN_SHARE)).toBeNull();
    // Присутствующим право отозвано сразу при сохранении конфига.
    expect(lk.publish(code, idOf(1), TrackSource.SCREEN_SHARE)).toBeNull();
  });
});
