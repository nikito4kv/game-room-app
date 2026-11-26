import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackSource } from "livekit-server-sdk";
import {
  FakeLiveKit,
  FakeRedis,
  applyTestEnv,
  connectWithToken,
  jsonRequest,
  readResponse,
} from "@/lib/server/testFakes";

const h = vi.hoisted(() => ({
  redis: null as unknown,
  livekit: null as unknown,
  consume: vi.fn(),
  peek: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));
vi.mock("@/lib/livekit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/livekit")>()),
  getRoomService: () => h.livekit,
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  consumeLimit: (...args: unknown[]) => h.consume(...args),
  peekLimit: (...args: unknown[]) => h.peek(...args),
}));

import {
  parseRoomPublicMeta,
  type ApiErrorBody,
  type CreateRoomResponse,
  type TokenResponse,
} from "@/lib/api/contract";
import { setParticipantFlag } from "@/lib/roomSecret";
import { POST as createRoom } from "../rooms/route";
import { POST as moderate } from "../moderate/route";
import { POST as getToken } from "./route";

const { MICROPHONE: MIC, SCREEN_SHARE: SCREEN, SCREEN_SHARE_AUDIO: SCREEN_AUDIO } = TrackSource;

let lk: FakeLiveKit;
/** Вердикт лимита неудачных паролей (ключ — код комнаты). */
let passwordVerdict: { limited: false; remaining: number } | { limited: true; retryAfterSec: number };

const device = (n: number, secret = "s".repeat(43)) => ({ id: `device${n}`.padEnd(22, "x"), secret });
const identityOf = (n: number) => `u_${device(n).id}`;

async function newRoom(extra: Record<string, unknown> = {}): Promise<CreateRoomResponse> {
  const res = await readResponse<CreateRoomResponse>(
    await createRoom(jsonRequest("/api/rooms", { title: "Комната", ...extra })),
  );
  expect(res.status).toBe(200);
  return res.body;
}

function join(code: string, name: string, dev: { id: string; secret: string }, extra: Record<string, unknown> = {}) {
  return getToken(jsonRequest("/api/token", { v: 2, code, name, device: dev, ...extra })).then((r) =>
    readResponse<TokenResponse & ApiErrorBody>(r),
  );
}

/** Вошёл и подключился к LiveKit. */
async function enter(code: string, name: string, n: number, extra: Record<string, unknown> = {}) {
  const res = await join(code, name, device(n), extra);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await connectWithToken(lk, res.body.token);
  return res.body;
}

function moderateAs(token: string, code: string, command: Record<string, unknown>) {
  return moderate(jsonRequest("/api/moderate", { code, token, ...command })).then((r) => readResponse(r));
}

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  h.redis = new FakeRedis();
  lk = new FakeLiveKit();
  h.livekit = lk;
  passwordVerdict = { limited: false, remaining: 19 };
  h.consume.mockReset().mockImplementation(async (_limiter: unknown, id: string) =>
    id.includes(":") ? { limited: false, remaining: 29 } : passwordVerdict,
  );
  h.peek.mockReset().mockResolvedValue({ remaining: 20, retryAfterSec: 600 });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T18:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/token", () => {
  it("владелец с ключом становится хостом; права без камеры и своих data-пакетов", async () => {
    const { code, hostKey } = await newRoom();
    const res = await join(code, "  Аня ", device(1), { hostKey });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      identity: identityOf(1),
      name: "Аня",
      isHost: true,
      isOwner: true,
      serverUrl: "ws://livekit.test",
      room: { title: "Комната", hostIdentity: identityOf(1), ownerIdentity: identityOf(1), hostName: "Аня" },
    });
    const p = await connectWithToken(lk, res.body.token);
    expect(p.name).toBe("Аня");
    expect(p.permission).toMatchObject({ canPublish: true, canPublishData: false, canSubscribe: true });
    expect(p.permission.canPublishSources).toEqual([MIC, SCREEN, SCREEN_AUDIO]);
    // Зеркало описания в LiveKit обновлено.
    expect(parseRoomPublicMeta(lk.rooms.get(code)?.metadata)?.hostIdentity).toBe(identityOf(1));
  });

  it("гость — не хост; занятый ник — NAME_TAKEN с подсказкой", async () => {
    const { code, hostKey } = await newRoom();
    await enter(code, "Аня", 1, { hostKey });
    const clash = await join(code, "АНЯ", device(2));
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: "NAME_TAKEN", suggestion: "АНЯ 2" });
    const ok = await join(code, "Боря", device(2));
    expect(ok.body).toMatchObject({ isHost: false, isOwner: false, identity: identityOf(2) });
  });

  it("свой же identity в комнате (обрыв, вторая вкладка) — пускаем, а не «ник занят»", async () => {
    const { code } = await newRoom();
    await enter(code, "Боря", 2);
    const again = await join(code, "Боря", device(2));
    expect(again.status).toBe(200);
  });

  it("место закреплено за устройством: тот же id с чужим секретом — SEAT_TAKEN", async () => {
    const { code } = await newRoom();
    await enter(code, "Боря", 2);
    const thief = await join(code, "Вор", device(2, "t".repeat(43)));
    expect(thief.status).toBe(409);
    expect(thief.body.error.code).toBe("SEAT_TAKEN");
  });

  it("без версии протокола — CLIENT_OUTDATED; кривое устройство и ник — понятные отказы", async () => {
    const { code } = await newRoom();
    const old = await readResponse<ApiErrorBody>(
      await getToken(jsonRequest("/api/token", { code, name: "Аня", device: device(1) })),
    );
    expect(old.status).toBe(426);
    expect(old.body.error.code).toBe("CLIENT_OUTDATED");
    expect((await join(code, "Аня", { id: "x", secret: "y" })).body.error.code).toBe("BAD_REQUEST");
    const shortName = await join(code, "Я", device(1));
    expect(shortName.body.error).toMatchObject({ code: "INVALID_NAME", message: expect.stringContaining("коротк") });
  });

  it("комнаты нет — ROOM_NOT_FOUND", async () => {
    const res = await join("ZZZZZZ", "Аня", device(1));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("частые входы — RATE_LIMITED с retryAfterSec", async () => {
    const { code } = await newRoom();
    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 42 });
    const res = await join(code, "Аня", device(1));
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 42 });
  });

  it("Redis недоступен — SERVICE_UNAVAILABLE, а не зависание", async () => {
    const { code } = await newRoom();
    h.redis = new Proxy(
      {},
      {
        get: () => () => {
          throw Object.assign(new Error("connection refused"), { name: "UpstashError" });
        },
      },
    );
    const res = await join(code, "Аня", device(1));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("пароль", () => {
  it("нужен пароль → неверный (с остатком попыток) → верный", async () => {
    const { code } = await newRoom({ password: "secret1" });
    const none = await join(code, "Боря", device(2));
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("PASSWORD_REQUIRED");

    passwordVerdict = { limited: false, remaining: 4 };
    const wrong = await join(code, "Боря", device(2), { password: "nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: "WRONG_PASSWORD", attemptsLeft: 4 });

    expect((await join(code, "Боря", device(2), { password: "secret1" })).status).toBe(200);
  });

  it("исчерпан лимит — отказ ДО сверки: верный пароль тоже ждёт", async () => {
    const { code } = await newRoom({ password: "secret1" });
    h.peek.mockResolvedValue({ remaining: 0, retryAfterSec: 120 });
    const res = await join(code, "Боря", device(2), { password: "secret1" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "TOO_MANY_ATTEMPTS", retryAfterSec: 120 });
  });

  it("владелец с ключом входит без пароля", async () => {
    const { code, hostKey } = await newRoom({ password: "secret1" });
    expect((await join(code, "Аня", device(1), { hostKey })).status).toBe(200);
  });

  it("слишком короткий пароль при создании — INVALID_PASSWORD", async () => {
    const res = await readResponse<ApiErrorBody>(
      await createRoom(jsonRequest("/api/rooms", { title: "Комната", password: "123" })),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PASSWORD");
  });
});

describe("кик, бан, замок, заполненность", () => {
  it("кик закрывает вход на 5 минут, потом пускает", async () => {
    const { code, hostKey } = await newRoom();
    const owner = await enter(code, "Аня", 1, { hostKey });
    await enter(code, "Боря", 2);

    const kick = await moderateAs(owner.token, code, { action: "kick", target: identityOf(2) });
    expect(kick.status).toBe(200);
    expect(lk.removed).toContainEqual({ room: code, identity: identityOf(2) });

    const back = await join(code, "Боря", device(2));
    expect(back.status).toBe(403);
    expect(back.body.error).toMatchObject({ code: "KICKED", retryAfterSec: 300 });

    vi.setSystemTime(Date.now() + 301_000);
    expect((await join(code, "Боря", device(2))).status).toBe(200);
  });

  it("бан и разбан", async () => {
    const { code, hostKey } = await newRoom();
    const owner = await enter(code, "Аня", 1, { hostKey });
    await enter(code, "Боря", 2);
    await moderateAs(owner.token, code, { action: "ban", target: identityOf(2) });
    const banned = await join(code, "Боря", device(2));
    expect(banned.status).toBe(403);
    expect(banned.body.error.code).toBe("BANNED");
    await moderateAs(owner.token, code, { action: "unban", target: identityOf(2) });
    expect((await join(code, "Боря", device(2))).status).toBe(200);
  });

  it("замок: новый — ROOM_LOCKED, бывший участник возвращается", async () => {
    const { code, hostKey } = await newRoom();
    const owner = await enter(code, "Аня", 1, { hostKey });
    await enter(code, "Боря", 2);
    await setParticipantFlag(code, "members", identityOf(2), true); // это делает вебхук при входе
    lk.leave(code, identityOf(2));
    await moderateAs(owner.token, code, { action: "settings", settings: { locked: true } });

    const stranger = await join(code, "Вера", device(3));
    expect(stranger.status).toBe(403);
    expect(stranger.body.error.code).toBe("ROOM_LOCKED");
    expect((await join(code, "Боря", device(2))).status).toBe(200);
  });

  it("десять человек — одиннадцатому ROOM_FULL", async () => {
    const { code } = await newRoom();
    for (let i = 1; i <= 10; i++) await enter(code, `Игрок ${i}`, i);
    const res = await join(code, "Лишний", device(11));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ROOM_FULL");
  });
});

describe("восстановление после перезапуска LiveKit", () => {
  it("LiveKit потерял комнату — вход пересоздаёт её с описанием и настройками из Redis", async () => {
    const { code, hostKey } = await newRoom({ isPublic: true });
    const owner = await enter(code, "Аня", 1, { hostKey });
    await moderateAs(owner.token, code, { action: "settings", settings: { screen: "host", chat: "off" } });

    await lk.deleteRoom(code); // перезапуск LiveKit: комнат в памяти больше нет
    expect(lk.rooms.has(code)).toBe(false);

    const res = await join(code, "Боря", device(2));
    expect(res.status).toBe(200);
    const meta = parseRoomPublicMeta(lk.rooms.get(code)?.metadata);
    expect(meta).toMatchObject({
      title: "Комната",
      isPublic: true,
      hostIdentity: identityOf(1),
      settings: { screen: "host", chat: "off" },
    });
    expect(lk.rooms.get(code)?.maxParticipants).toBe(10);
    // Права гостя — по сохранённой политике экрана.
    const p = await connectWithToken(lk, res.body.token);
    expect(p.permission.canPublishSources).toEqual([MIC]);
  });

  it("пустая metadata у существующей комнаты (создал сам LiveKit) — заполняется", async () => {
    const { code } = await newRoom();
    await lk.updateRoomMetadata(code, "");
    expect((await join(code, "Боря", device(2))).status).toBe(200);
    expect(parseRoomPublicMeta(lk.rooms.get(code)?.metadata)?.title).toBe("Комната");
  });
});

describe("запросы клиента прежней версии (вкладка открыта до обновления сайта)", () => {
  it("вход без device и v — CLIENT_OUTDATED в обычном формате ошибки", async () => {
    const { code } = await newRoom();
    const res = await readResponse<ApiErrorBody>(
      await getToken(jsonRequest("/api/token", { code, nickname: "Боря" })),
    );
    expect(res.status).toBe(426);
    expect(res.body.error.code).toBe("CLIENT_OUTDATED");
  });

  it("ник создателя в POST /api/rooms не делает его хостом: место ждёт владельца с ключом", async () => {
    const { code } = await newRoom({ nickname: "Анна" });
    expect(parseRoomPublicMeta(lk.rooms.get(code)?.metadata)?.hostIdentity).toBeNull();
  });
});
