import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

import {
  VOICE_ATTRIBUTES,
  parseVoiceAttributes,
  type ApiErrorBody,
  type CreateRoomResponse,
  type TokenResponse,
  type VoiceResponse,
} from "@/lib/api/contract";
import { POST as createRoom } from "../rooms/route";
import { POST as getToken } from "../token/route";
import { POST as moderate } from "../moderate/route";
import { POST as voice } from "./route";

let lk: FakeLiveKit;
let code: string;
let hostToken: string;
let guestToken: string;
const device = (n: number) => ({ id: `device${n}`.padEnd(22, "x"), secret: "s".repeat(43) });
const hostId = `u_${device(1).id}`;
const guestId = `u_${device(2).id}`;

async function enter(name: string, n: number, hostKey?: string): Promise<string> {
  const res = await readResponse<TokenResponse>(
    await getToken(jsonRequest("/api/token", { v: 2, code, name, device: device(n), hostKey })),
  );
  await connectWithToken(lk, res.body.token);
  return res.body.token;
}

const send = (token: string, state: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  voice(jsonRequest("/api/voice", { code, token, ...state, ...extra })).then((r) =>
    readResponse<VoiceResponse & ApiErrorBody>(r),
  );
const person = (identity: string) => lk.participants.get(code)!.get(identity)!;
const attributeWrites = () => lk.updateCalls.filter((u) => u.attributes !== undefined);

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
  lk.updateCalls = [];
});

describe("POST /api/voice", () => {
  it("пишет «звук выкл» и рацию в атрибуты вызывающего; снятие убирает ключ", async () => {
    const on = await send(guestToken, { deafened: true, ptt: true });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ ok: true });
    expect(person(guestId).attributes).toEqual({
      [VOICE_ATTRIBUTES.deafened]: "1",
      [VOICE_ATTRIBUTES.ptt]: "1",
    });

    await send(guestToken, { deafened: false, ptt: true });
    expect(parseVoiceAttributes(person(guestId).attributes)).toEqual({ deafened: false, ptt: true });
    expect(person(guestId).attributes).not.toHaveProperty(VOICE_ATTRIBUTES.deafened);
    // Хозяина чужого токена не задело.
    expect(person(hostId).attributes).toEqual({});
  });

  it("пишет каждый раз, не читая атрибуты: Server SDK отдаёт их ключи в camelCase", async () => {
    await send(guestToken, { deafened: true, ptt: false });
    // Так сервер «видит» атрибуты в ответе LiveKit — по ним сверяться нельзя.
    expect((await lk.getParticipant(code, guestId)).attributes).toEqual({ voiceDeafened: "1" });
    // Снятие доходит, хотя прочитанное выглядело бы как «ничего не включено».
    await send(guestToken, { deafened: false, ptt: false });
    expect(person(guestId).attributes).toEqual({});
    expect(attributeWrites()).toHaveLength(2);
  });

  it("кому писать — только из подписи токена; поле identity в теле ничего не решает", async () => {
    await send(guestToken, { deafened: true, ptt: false }, { identity: hostId });
    expect(person(hostId).attributes).toEqual({});
    expect(parseVoiceAttributes(person(guestId).attributes).deafened).toBe(true);
  });

  it("metadata и права участника не меняются (мьют хоста остаётся)", async () => {
    await moderate(jsonRequest("/api/moderate", { code, token: hostToken, action: "mute", target: guestId }));
    const before = { metadata: person(guestId).metadata, permission: { ...person(guestId).permission } };
    await send(guestToken, { deafened: true, ptt: false });
    expect(person(guestId).metadata).toBe(before.metadata);
    expect(person(guestId).permission).toEqual(before.permission);
    expect(attributeWrites().at(-1)).toMatchObject({ metadata: undefined, permission: undefined });
  });

  it("кривое тело — BAD_REQUEST", async () => {
    expect((await send(guestToken, { deafened: "да", ptt: false })).body.error.code).toBe("BAD_REQUEST");
    expect((await send(guestToken, { deafened: true })).body.error.code).toBe("BAD_REQUEST");
    const notJson = await voice(
      new Request("http://app.test/api/voice", { method: "POST", body: "{", headers: { "content-type": "application/json" } }),
    );
    expect(notJson.status).toBe(400);
    expect(attributeWrites()).toEqual([]);
  });

  it("чужой или подделанный токен — UNAUTHORIZED; не в комнате — NOT_IN_ROOM", async () => {
    const forged = await send("подделка", { deafened: true, ptt: false });
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe("UNAUTHORIZED");

    lk.leave(code, guestId);
    const gone = await send(guestToken, { deafened: true, ptt: false });
    expect(gone.status).toBe(403);
    expect(gone.body.error.code).toBe("NOT_IN_ROOM");
    expect(attributeWrites()).toEqual([]);
  });

  it("токен другой комнаты не подходит", async () => {
    const other = await readResponse<CreateRoomResponse>(
      await createRoom(jsonRequest("/api/rooms", { title: "Другая" })),
    );
    const res = await voice(
      jsonRequest("/api/voice", { code: other.body.code, token: guestToken, deafened: true, ptt: false }),
    );
    expect(res.status).toBe(401);
  });

  it("лимит частоты на участника — RATE_LIMITED с retryAfterSec", async () => {
    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 4 });
    const res = await send(guestToken, { deafened: true, ptt: false });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 4 });
    expect(h.consume).toHaveBeenLastCalledWith(expect.anything(), `${code}:${guestId}`);
    expect(attributeWrites()).toEqual([]);
  });

  it("LiveKit не отвечает — SERVICE_UNAVAILABLE", async () => {
    vi.spyOn(lk, "updateParticipant").mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await send(guestToken, { deafened: true, ptt: false });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
