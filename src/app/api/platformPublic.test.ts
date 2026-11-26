// Публичные маршруты платформы на фейках: ключи клубов при создании комнаты,
// жалобы, заявки-диалоги, настройки для браузера, маяк, чат (флаг и детектор).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeLiveKit,
  FakeRedis,
  applyTestEnv,
  connectWithToken,
  jsonRequest,
  readResponse,
} from "@/lib/server/testFakes";

const h = vi.hoisted(() => ({ redis: null as unknown, livekit: null as unknown, consume: vi.fn() }));
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

import type { CreateRoomResponse, PreviewResponse, TokenResponse } from "@/lib/api/contract";
import {
  DEFAULT_RUNTIME_CONFIG,
  EVENTS_STREAM,
  type LeadCreateResponse,
  type LeadThreadPublic,
  type PublicConfigResponse,
  type StoredEvent,
} from "@/lib/api/platform";
import { createAccessKey } from "@/lib/platform/accessKeys";
import { readEvents, settleEvents } from "@/lib/platform/events";
import { listReports } from "@/lib/platform/reports";
import { CONFIG_KEY, resetConfigCache } from "@/lib/platform/runtimeConfig";
import { teamReply } from "@/lib/platform/leadThreads";
import { POST as createRoom } from "./rooms/route";
import { GET as preview } from "./rooms/[code]/route";
import { POST as getToken } from "./token/route";
import { POST as chat } from "./chat/route";
import { POST as report } from "./report/route";
import { GET as config } from "./config/route";
import { POST as beacon } from "./ev/route";
import { POST as createLead } from "./leads/route";
import { GET as readLead } from "./leads/[id]/route";
import { POST as leadMessage } from "./leads/[id]/messages/route";
import { POST as leadStatus } from "./leads/status/route";

type Err = { error: { code: string; message: string; fields?: Record<string, string> } };
let redis: FakeRedis;
let lk: FakeLiveKit;
const device = (n: number) => ({ id: `device${n}`.padEnd(22, "x"), secret: "s".repeat(43) });

const setConfig = async (patch: Record<string, unknown>) => {
  await redis.set(CONFIG_KEY, JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, ...patch }));
  resetConfigCache();
};
const allEvents = async (): Promise<StoredEvent[]> => {
  await settleEvents();
  return (await readEvents(null, 1000)).events;
};
const enter = async (code: string, name: string, n: number, extra: Record<string, unknown> = {}) =>
  readResponse<TokenResponse & Err>(await getToken(jsonRequest("/api/token", { v: 2, code, name, device: device(n), ...extra })));

beforeAll(() => applyTestEnv());
beforeEach(() => {
  redis = new FakeRedis();
  h.redis = redis;
  lk = new FakeLiveKit();
  h.livekit = lk;
  h.consume.mockReset().mockResolvedValue({ limited: false, remaining: 5 });
  resetConfigCache();
});

describe("ключ клуба при создании комнаты", () => {
  const req = { type: "club" as const, label: "Арена", color: "#ff8800", maxParticipants: 15, expiresAt: null, maxUses: 1, ref: null };

  it("верный ключ: бейдж в мете, лимит LiveKit = ключа, событие room_created с key", async () => {
    const { key, secret } = await createAccessKey(req);
    const res = await readResponse<CreateRoomResponse>(
      await createRoom(jsonRequest("/api/rooms", { title: "Клуб", key: secret.toLowerCase(), isPublic: true })),
    );
    expect(res.status).toBe(200);
    const room = lk.rooms.get(res.body.code)!;
    expect(room.maxParticipants).toBe(15);
    expect(JSON.parse(room.metadata).badge).toEqual({ label: "Арена", color: "#ff8800" });
    expect(JSON.parse(room.metadata)).not.toHaveProperty("keyId");
    const pv = await readResponse<PreviewResponse>(
      await preview(jsonRequest(`/api/rooms/${res.body.code}`), { params: Promise.resolve({ code: res.body.code }) }),
    );
    expect(pv.body).toMatchObject({ maxParticipants: 15, badge: { label: "Арена" } });
    const tok = await enter(res.body.code, "Хост", 1, { hostKey: res.body.hostKey });
    expect(tok.body.room.badge).toEqual({ label: "Арена", color: "#ff8800" });
    expect((await allEvents()).find((e) => e.t === "room_created")).toMatchObject({ key: key.id, isPublic: "1" });

    // maxUses: 1 — второй раз нельзя; LiveKit потерял комнату — пересоздаётся с тем же лимитом.
    const again = await readResponse<Err>(await createRoom(jsonRequest("/api/rooms", { title: "Клуб", key: secret })));
    expect(again.body.error).toMatchObject({ code: "INVALID_KEY" });
    await lk.deleteRoom(res.body.code);
    await enter(res.body.code, "Хост", 1, { hostKey: res.body.hostKey });
    expect(lk.rooms.get(res.body.code)?.maxParticipants).toBe(15);
  });

  it("неверный ключ — INVALID_KEY и комната не создаётся; флаг выключен — FEATURE_DISABLED", async () => {
    const bad = await readResponse<Err>(await createRoom(jsonRequest("/api/rooms", { title: "x", key: "GR-AAAA-BBBB-CCCC" })));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_KEY");
    expect(lk.rooms.size).toBe(0);
    await setConfig({ flags: { access_keys: { mode: "off" } } });
    const off = await readResponse<Err>(await createRoom(jsonRequest("/api/rooms", { title: "x", key: "GR-AAAA-BBBB-CCCC" })));
    expect(off.body.error.code).toBe("FEATURE_DISABLED");
  });

  it("лимит людей из настроек продукта и общий лимит новых комнат в минуту", async () => {
    await setConfig({ limits: { ...DEFAULT_RUNTIME_CONFIG.limits, maxParticipants: 2, newRoomsPerMinute: 1 } });
    const res = await readResponse<CreateRoomResponse>(await createRoom(jsonRequest("/api/rooms", { title: "x" })));
    expect(lk.rooms.get(res.body.code)?.maxParticipants).toBe(2);
    const second = await readResponse<Err>(await createRoom(jsonRequest("/api/rooms", { title: "y" })));
    expect(second.body.error.code).toBe("RATE_LIMITED");
    await connectWithToken(lk, (await enter(res.body.code, "Аня", 1, { hostKey: res.body.hostKey })).body.token);
    await connectWithToken(lk, (await enter(res.body.code, "Боря", 2)).body.token);
    const full = await enter(res.body.code, "Вова", 3);
    expect(full.body.error).toMatchObject({ code: "ROOM_FULL", message: "Комната заполнена: в ней уже 2 человек" });
  });

  it("лимит частоты создания с адреса — сигнал room_spam", async () => {
    h.consume.mockResolvedValue({ limited: true, retryAfterSec: 30 });
    await createRoom(jsonRequest("/api/rooms", { title: "x" }, { "x-real-ip": "5.5.5.5" }));
    expect((await allEvents()).find((e) => e.t === "signal")).toMatchObject({ kind: "room_spam", ip: "5.5.5.5" });
  });
});

describe("комната: чат, жалоба, вход", () => {
  let code: string;
  let hostToken: string;
  beforeEach(async () => {
    const res = await readResponse<CreateRoomResponse>(await createRoom(jsonRequest("/api/rooms", { title: "Комната" })));
    code = res.body.code;
    hostToken = (await enter(code, "Аня", 1, { hostKey: res.body.hostKey, rulesVersion: "2026-10-06" })).body.token;
    await connectWithToken(lk, hostToken);
  });

  it("событие join с версией правил", async () => {
    expect((await allEvents()).find((e) => e.t === "join")).toMatchObject({ code, owner: "1", rules: "2026-10-06" });
  });

  it("чат: подозрительное слово — сообщение уходит, сигнал chat_flag; feature chat раз в минуту", async () => {
    const say = (text: string) => chat(jsonRequest("/api/chat", { code, token: hostToken, text }));
    expect((await say("ну ты и мразь")).status).toBe(200);
    expect((await say("привет")).status).toBe(200);
    const ev = await allEvents();
    expect(ev.filter((e) => e.t === "signal" && e.kind === "chat_flag")).toHaveLength(1);
    expect(ev.filter((e) => e.t === "feature" && e.name === "chat")).toHaveLength(1);
    expect(lk.sentData).toHaveLength(2);
  });

  it("чат выключен флагом — CHAT_DISABLED с текстом администрации", async () => {
    await setConfig({ flags: { chat: { mode: "off" } } });
    const res = await readResponse<Err>(await chat(jsonRequest("/api/chat", { code, token: hostToken, text: "привет" })));
    expect(res.body.error).toEqual({ code: "CHAT_DISABLED", message: "Чат временно выключен администрацией" });
  });

  it("жалоба: снимок чата, событие report; лимит — сигнал report_spam; флаг выключен — FEATURE_DISABLED", async () => {
    await chat(jsonRequest("/api/chat", { code, token: hostToken, text: "сообщение до жалобы" }));
    const ok = await readResponse<{ ok: true; id: string }>(
      await report(jsonRequest("/api/report", { code, token: hostToken, reason: "spam", note: "реклама" })),
    );
    expect(ok.status).toBe(200);
    const [stored] = (await listReports()).reports;
    expect(stored).toMatchObject({ id: ok.body.id, code, reason: "spam", note: "реклама", reporterName: "Аня" });
    expect(stored?.chatSnapshot.map((m) => m.text)).toEqual(["сообщение до жалобы"]);
    expect((await allEvents()).find((e) => e.t === "report")).toMatchObject({ reportId: ok.body.id, code });

    expect((await report(jsonRequest("/api/report", { code, token: "чужой", reason: "spam" }))).status).toBe(401);
    expect((await report(jsonRequest("/api/report", { code, token: hostToken, reason: "nope" }))).status).toBe(400);

    h.consume.mockResolvedValue({ limited: true, retryAfterSec: 60 });
    expect((await report(jsonRequest("/api/report", { code, token: hostToken, reason: "spam" }))).status).toBe(429);
    expect((await allEvents()).some((e) => e.t === "signal" && e.kind === "report_spam")).toBe(true);

    h.consume.mockResolvedValue({ limited: false, remaining: 5 });
    // Суточный потолок сайта — 429 и сигнал high.
    await redis.set(`gr:reports:day:${new Date().toISOString().slice(0, 10)}`, "500");
    expect((await report(jsonRequest("/api/report", { code, token: hostToken, reason: "spam" }))).status).toBe(429);
    expect((await allEvents()).some((e) => e.t === "signal" && e.kind === "report_spam" && e.severity === "high")).toBe(true);

    await setConfig({ flags: { reports: { mode: "off" } } });
    const off = await readResponse<Err>(await report(jsonRequest("/api/report", { code, token: hostToken, reason: "spam" })));
    expect(off.body.error.code).toBe("FEATURE_DISABLED");
  });

  it("неверный пароль — сигнал password_fail; закрытая витрина — пустой список", async () => {
    const res = await readResponse<CreateRoomResponse>(
      await createRoom(jsonRequest("/api/rooms", { title: "С паролем", password: "1234" })),
    );
    await enter(res.body.code, "Вова", 3, { password: "0000" });
    expect((await allEvents()).find((e) => e.t === "signal")).toMatchObject({ kind: "password_fail", severity: "low" });
    expect((await allEvents()).find((e) => e.t === "join_fail")).toMatchObject({ reason: "WRONG_PASSWORD" });
  });
});

describe("заявки-диалоги", () => {
  const body = { kind: "club", product: "club", name: "Арена", message: "Хотим пилот", consent: true, clubName: "Арена" };

  it("создание → чтение по токену → ответ команды → «есть ответ» → дописать", async () => {
    const created = await readResponse<LeadCreateResponse>(await createLead(jsonRequest("/api/leads", body)));
    expect(created.status).toBe(200);
    const { id, token, url } = created.body;
    expect(url).toBe(`/request/${id}?t=${token}`);
    const p = { params: Promise.resolve({ id }) };
    const hdr = (t: string) => ({ "x-lead-token": t });
    expect((await readLead(jsonRequest(`/api/leads/${id}`, undefined, hdr("wrong")), p)).status).toBe(404);
    // Токен в адресе API больше не принимается — только заголовком.
    expect((await readLead(jsonRequest(`/api/leads/${id}?t=${token}`), p)).status).toBe(404);
    await teamReply(id, "Здравствуйте!");
    const st = await readResponse<{ items: { hasUnread: boolean }[] }>(
      await leadStatus(jsonRequest("/api/leads/status", { items: [{ id, t: token }, { id: "zzzzzzzz", t: "x" }] })),
    );
    expect(st.body.items).toEqual([{ id, hasUnread: true, status: "answered" }]);
    const read = await readResponse<LeadThreadPublic>(await readLead(jsonRequest(`/api/leads/${id}`, undefined, hdr(token)), p));
    expect(read.body.hasUnread).toBe(true);
    const reply = await readResponse<LeadThreadPublic>(
      await leadMessage(jsonRequest(`/api/leads/${id}/messages`, { text: "Спасибо!" }, hdr(token)), p),
    );
    expect(reply.body.messages.map((m) => m.from)).toEqual(["user", "team", "user"]);
    const ev = await allEvents();
    expect(ev.find((e) => e.t === "lead")).toMatchObject({ leadId: id, kind: "club", product: "club" });
    expect(ev.find((e) => e.t === "lead_msg")).toMatchObject({ leadId: id });
  });

  it("повтор той же заявки в течение 10 минут — 409 LEAD_DUPLICATE, другая — проходит", async () => {
    expect((await createLead(jsonRequest("/api/leads", body))).status).toBe(200);
    const again = await readResponse<Err>(
      await createLead(jsonRequest("/api/leads", { ...body, message: "  ХОТИМ   пилот " })),
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("LEAD_DUPLICATE");
    expect((await createLead(jsonRequest("/api/leads", { ...body, message: "Другой вопрос" }))).status).toBe(200);
  });

  it("ошибки по полям, ловушка для ботов, выключенный флаг", async () => {
    const bad = await readResponse<Err>(await createLead(jsonRequest("/api/leads", { ...body, name: "", consent: false })));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_LEAD");
    expect(Object.keys(bad.body.error.fields ?? {}).sort()).toEqual(["consent", "name"]);

    const bot = await readResponse<LeadCreateResponse>(await createLead(jsonRequest("/api/leads", { ...body, website: "http://spam" })));
    expect(bot.body.ok).toBe(true);
    expect(await redis.get(`gr:lead:${bot.body.id}`)).toBeNull();

    await setConfig({ flags: { leads: { mode: "off" } } });
    const off = await readResponse<Err>(await createLead(jsonRequest("/api/leads", body)));
    expect(off.body.error.code).toBe("FEATURE_DISABLED");
  });
});

describe("настройки для браузера и маяк", () => {
  it("GET /api/config — вычисленные флаги и объявления", async () => {
    await setConfig({
      flags: { chat: { mode: "list", rooms: ["ABCD"] } },
      announcements: [{ id: "x", text: "Техработы", level: "warning", where: "room", startsAt: null, endsAt: null }],
    });
    const room = await readResponse<PublicConfigResponse>(await config(jsonRequest("/api/config?room=abcd")));
    expect(room.body.flags.chat).toBe(true);
    expect(room.body.announcements).toEqual([{ id: "x", text: "Техработы", level: "warning" }]);
    const site = await readResponse<PublicConfigResponse>(await config(jsonRequest("/api/config")));
    expect(site.body.flags.chat).toBe(false);
    expect(site.body.announcements).toEqual([]);
  });

  it("POST /api/ev — всегда 204, мусор не пишет", async () => {
    const send = (text: string) =>
      beacon(new Request("http://app.test/api/ev", { method: "POST", body: text, headers: { "x-real-ip": "7.7.7.7" } }));
    expect((await send(JSON.stringify({ path: "/pricing", utm_source: "vk", vid: "v1" }))).status).toBe(204);
    expect((await send("не json")).status).toBe(204);
    expect((await send(JSON.stringify({ path: "http://evil" }))).status).toBe(204);
    expect((await send(JSON.stringify({ path: "/" + "a".repeat(3000) }))).status).toBe(204);
    const ev = await allEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ t: "page", path: "/pricing", utm_source: "vk", vid: "v1", ip: "7.7.7.7" });
    expect(redis.keys()).toContain(EVENTS_STREAM);
  });
});
