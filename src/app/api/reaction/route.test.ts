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

import type { ApiErrorBody, CreateRoomResponse, ReactionResponse, TokenResponse } from "@/lib/api/contract";
import { DEFAULT_RUNTIME_CONFIG } from "@/lib/api/platform";
import { readEvents, settleEvents } from "@/lib/platform/events";
import { CONFIG_KEY, resetConfigCache } from "@/lib/platform/runtimeConfig";
import { POST as createRoom } from "../rooms/route";
import { POST as getToken } from "../token/route";
import { POST as react } from "./route";

let redis: FakeRedis;
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

const send = (token: string, kind: unknown, extra: Record<string, unknown> = {}) =>
  react(jsonRequest("/api/reaction", { code, token, kind, ...extra })).then((r) =>
    readResponse<ReactionResponse & ApiErrorBody>(r),
  );

const setFlag = async (mode: "on" | "off") => {
  await redis.set(CONFIG_KEY, JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, flags: { reactions: { mode } } }));
  resetConfigCache();
};

beforeAll(() => {
  applyTestEnv();
});

beforeEach(async () => {
  redis = new FakeRedis();
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
});

describe("POST /api/reaction", () => {
  it("рассылает всем от имени сервера; кто реагирует — из токена, а не из тела", async () => {
    const before = Date.now();
    const res = await send(guestToken, "fire", { identity: hostId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(lk.sentData).toHaveLength(1);
    const [sent] = lk.sentData;
    expect(sent).toMatchObject({ room: code, topic: "reaction", kind: DataPacket_Kind.RELIABLE });
    expect(sent.payload).toMatchObject({ identity: guestId, kind: "fire" });
    expect((sent.payload as { at: number }).at).toBeGreaterThanOrEqual(before);
  });

  it("все четыре реакции проходят; неизвестная и не строка — BAD_REQUEST, без рассылки", async () => {
    for (const kind of ["like", "fire", "lol", "gg"]) expect((await send(hostToken, kind)).status).toBe(200);
    expect(lk.sentData.map((d) => (d.payload as { kind: string }).kind)).toEqual(["like", "fire", "lol", "gg"]);
    lk.sentData = [];
    for (const kind of ["heart", "", 1, null, undefined, ["fire"]]) {
      expect((await send(hostToken, kind)).body.error.code).toBe("BAD_REQUEST");
    }
    expect(lk.sentData).toEqual([]);
  });

  it("реакции выключены флагом — FEATURE_DISABLED, даже хосту; включены снова — работают", async () => {
    await setFlag("off");
    const off = await send(hostToken, "gg");
    expect(off.status).toBe(503);
    expect(off.body.error).toEqual({ code: "FEATURE_DISABLED", message: "Реакции временно выключены" });
    expect(lk.sentData).toEqual([]);
    await setFlag("on");
    expect((await send(hostToken, "gg")).status).toBe(200);
  });

  it("флуд — RATE_LIMITED с retryAfterSec; счётчик свой у каждого участника", async () => {
    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 3 });
    const res = await send(guestToken, "lol");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 3 });
    expect(h.consume).toHaveBeenLastCalledWith(expect.anything(), `${code}:${guestId}`);
    expect(lk.sentData).toEqual([]);
  });

  it("не в комнате — NOT_IN_ROOM; чужой или пустой токен — UNAUTHORIZED; кривой код — ROOM_NOT_FOUND", async () => {
    lk.leave(code, guestId);
    expect((await send(guestToken, "like")).body.error.code).toBe("NOT_IN_ROOM");
    expect((await send("подделка", "like")).body.error.code).toBe("UNAUTHORIZED");
    expect((await send("", "like")).body.error.code).toBe("UNAUTHORIZED");
    const badCode = await readResponse<ApiErrorBody>(
      await react(jsonRequest("/api/reaction", { code: "!!", token: hostToken, kind: "like" })),
    );
    expect(badCode.body.error.code).toBe("ROOM_NOT_FOUND");
    expect(lk.sentData).toEqual([]);
  });

  it("событие для админки: feature reaction с видом, без ника; раз в минуту на человека и вид", async () => {
    for (const kind of ["fire", "fire", "lol", "fire"]) expect((await send(guestToken, kind)).status).toBe(200);
    await send(hostToken, "fire");
    await settleEvents();
    const features = (await readEvents(null, 100)).events.filter((e) => e.t === "feature");
    expect(features.map((e) => e.t === "feature" && [e.name, e.identity, e.kind])).toEqual([
      ["reaction", guestId, "fire"],
      ["reaction", guestId, "lol"],
      ["reaction", hostId, "fire"],
    ]);
    expect(JSON.stringify(features)).not.toMatch(/Аня|Боря/);
  });

  it("LiveKit не ответил — SERVICE_UNAVAILABLE", async () => {
    lk.sendData = async () => {
      throw Object.assign(new Error("down"), { name: "AbortError" });
    };
    const res = await send(hostToken, "fire");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
