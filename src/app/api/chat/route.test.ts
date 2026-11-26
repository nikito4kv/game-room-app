import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DataPacket_Kind } from "livekit-server-sdk";
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

import type {
  ApiErrorBody,
  ChatHistoryResponse,
  ChatPostResponse,
  CreateRoomResponse,
  TokenResponse,
} from "@/lib/api/contract";
import { POST as createRoom } from "../rooms/route";
import { POST as getToken } from "../token/route";
import { POST as moderate } from "../moderate/route";
import { GET as history, POST as send } from "./route";

let lk: FakeLiveKit;
let code: string;
let hostToken: string;
let guestToken: string;
const device = (n: number) => ({ id: `device${n}`.padEnd(22, "x"), secret: "s".repeat(43) });
const guestId = `u_${device(2).id}`;

async function enter(name: string, n: number, hostKey?: string): Promise<string> {
  const res = await readResponse<TokenResponse>(
    await getToken(jsonRequest("/api/token", { v: 2, code, name, device: device(n), hostKey })),
  );
  await connectWithToken(lk, res.body.token);
  return res.body.token;
}

const say = (token: string, text: unknown, extra: Record<string, unknown> = {}) =>
  send(jsonRequest("/api/chat", { code, token, text, ...extra })).then((r) =>
    readResponse<ChatPostResponse & ApiErrorBody>(r),
  );
const readHistory = (token?: string) =>
  history(jsonRequest(`/api/chat?code=${code}`, undefined, token ? { authorization: `Bearer ${token}` } : {})).then(
    (r) => readResponse<ChatHistoryResponse & ApiErrorBody>(r),
  );
const settings = (patch: Record<string, unknown>) =>
  moderate(jsonRequest("/api/moderate", { code, token: hostToken, action: "settings", settings: patch }));

beforeAll(() => {
  applyTestEnv();
});

beforeEach(async () => {
  h.redis = new FakeRedis();
  lk = new FakeLiveKit();
  h.livekit = lk;
  h.consume.mockReset().mockResolvedValue({ limited: false, remaining: 5 });
  const created = await readResponse<CreateRoomResponse>(
    await createRoom(jsonRequest("/api/rooms", { title: "Комната" })),
  );
  code = created.body.code;
  hostToken = await enter("Аня", 1, created.body.hostKey);
  guestToken = await enter("Боря", 2);
});

describe("POST /api/chat", () => {
  it("рассылает всем от имени сервера; автора ставит сервер, а не тело запроса", async () => {
    const res = await say(guestToken, "  привет  ", { from: { identity: "u_host", name: "Хост" } });
    expect(res.status).toBe(200);
    const message = res.body.message;
    expect(message).toMatchObject({ text: "привет", from: { identity: guestId, name: "Боря" } });
    expect(message.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(lk.sentData).toEqual([
      { room: code, payload: message, topic: "chat", kind: DataPacket_Kind.RELIABLE },
    ]);
  });

  it("история — для вошедшего позже, от старых к новым", async () => {
    await say(hostToken, "первое");
    await say(guestToken, "второе");
    const res = await readHistory(guestToken);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.text)).toEqual(["первое", "второе"]);
  });

  it("чат выключен — CHAT_DISABLED, даже хосту", async () => {
    await settings({ chat: "off" });
    expect((await say(guestToken, "эй")).body.error.code).toBe("CHAT_DISABLED");
    expect((await say(hostToken, "эй")).body.error.code).toBe("CHAT_DISABLED");
    expect(lk.sentData).toEqual([]);
  });

  it("только хост: гостю CHAT_HOST_ONLY, хосту можно", async () => {
    await settings({ chat: "host" });
    expect((await say(guestToken, "эй")).body.error.code).toBe("CHAT_HOST_ONLY");
    expect((await say(hostToken, "эй")).status).toBe(200);
  });

  it("персональный запрет чата", async () => {
    await moderate(jsonRequest("/api/moderate", { code, token: hostToken, action: "chatMute", target: guestId }));
    const res = await say(guestToken, "эй");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CHAT_MUTED");
  });

  it("валидация: пустое и длиннее 500 символов", async () => {
    expect((await say(guestToken, " \u0000 ")).body.error.code).toBe("MESSAGE_EMPTY");
    expect((await say(guestToken, "я".repeat(501))).body.error.code).toBe("MESSAGE_TOO_LONG");
    expect((await say(guestToken, 42)).body.error.code).toBe("BAD_REQUEST");
  });

  it("лимит частоты на участника — RATE_LIMITED с retryAfterSec", async () => {
    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 7 });
    const res = await say(guestToken, "спам");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 7 });
    expect(h.consume).toHaveBeenLastCalledWith(expect.anything(), `${code}:${guestId}`);
  });

  it("не в комнате — NOT_IN_ROOM; чужой токен — UNAUTHORIZED", async () => {
    lk.leave(code, guestId);
    expect((await say(guestToken, "эй")).body.error.code).toBe("NOT_IN_ROOM");
    expect((await say("подделка", "эй")).body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("GET /api/chat", () => {
  it("без токена или не из комнаты — отказ", async () => {
    expect((await readHistory()).body.error.code).toBe("UNAUTHORIZED");
    lk.leave(code, guestId);
    expect((await readHistory(guestToken)).body.error.code).toBe("NOT_IN_ROOM");
  });
});
