import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TwirpError } from "livekit-server-sdk";
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
  timeouts: [] as unknown[],
  consume: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));
vi.mock("@/lib/livekit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/livekit")>()),
  getRoomService: (...args: unknown[]) => {
    h.timeouts.push(args[0]);
    return h.livekit;
  },
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  consumeLimit: (...args: unknown[]) => h.consume(...args),
  peekLimit: async () => ({ remaining: 20, retryAfterSec: 600 }),
}));

import type { ApiErrorBody, CreateRoomResponse, PreviewResponse, TokenResponse } from "@/lib/api/contract";
import { LIVEKIT_QUICK_TIMEOUT_SEC } from "@/lib/livekit";
import { POST as createRoom } from "../route";
import { POST as getToken } from "../../token/route";
import { GET as preview } from "./route";

let lk: FakeLiveKit;
const device = (n: number) => ({ id: `device${n}`.padEnd(22, "x"), secret: "s".repeat(43) });

async function newRoom(extra: Record<string, unknown> = {}): Promise<CreateRoomResponse> {
  return (
    await readResponse<CreateRoomResponse>(
      await createRoom(jsonRequest("/api/rooms", { title: "Вечерняя катка", ...extra })),
    )
  ).body;
}

async function enter(code: string, name: string, n: number, extra: Record<string, unknown> = {}) {
  const res = await readResponse<TokenResponse>(
    await getToken(jsonRequest("/api/token", { v: 2, code, name, device: device(n), ...extra })),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await connectWithToken(lk, res.body.token);
}

function look(code: string) {
  return preview(jsonRequest(`/api/rooms/${code}`), { params: Promise.resolve({ code }) }).then((r) =>
    readResponse<PreviewResponse & ApiErrorBody>(r),
  );
}

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  h.redis = new FakeRedis();
  lk = new FakeLiveKit();
  h.livekit = lk;
  h.timeouts = [];
  h.consume.mockReset().mockResolvedValue({ limited: false, remaining: 50 });
});

describe("GET /api/rooms/[code] — превью для лобби", () => {
  it("описание, счётчик и кто внутри: хост первым", async () => {
    const { code, hostKey } = await newRoom({ isPublic: true });
    await enter(code, "Боря", 2);
    await enter(code, "Аня", 1, { hostKey });
    const res = await look(code.toLowerCase());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      code,
      title: "Вечерняя катка",
      hasPassword: false,
      locked: false,
      isPublic: true,
      participantCount: 2,
      maxParticipants: 10,
      participants: [
        { name: "Аня", isHost: true },
        { name: "Боря", isHost: false },
      ],
    });
  });

  it("у комнаты пароль — только количество, имена не светим", async () => {
    const { code, hostKey } = await newRoom({ password: "secret1" });
    await enter(code, "Аня", 1, { hostKey });
    const res = await look(code);
    expect(res.body).toMatchObject({ hasPassword: true, participantCount: 1 });
    expect(res.body).not.toHaveProperty("participants");
  });

  it("замок виден в превью", async () => {
    const { code } = await newRoom();
    await (h.redis as FakeRedis).hset(`room:${code}:meta`, { locked: "1" });
    expect((await look(code)).body.locked).toBe(true);
  });

  it("LiveKit спрашивается с коротким таймаутом", async () => {
    const { code } = await newRoom();
    await look(code);
    expect(h.timeouts.at(-1)).toBe(LIVEKIT_QUICK_TIMEOUT_SEC);
  });

  it("LiveKit не дал состав — превью без имён, счётчик из комнаты, без падения", async () => {
    const { code } = await newRoom();
    await enter(code, "Боря", 2);
    lk.listParticipants = async () => {
      throw new TwirpError("Service Unavailable", "timeout", 503);
    };
    const res = await look(code);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ participantCount: 1, title: "Вечерняя катка" });
    expect(res.body).not.toHaveProperty("participants");
  });

  it("LiveKit лежит целиком — 200, счётчик 0", async () => {
    const { code } = await newRoom();
    const down = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: "ECONNREFUSED" });
    };
    lk.listParticipants = down;
    lk.listRooms = down;
    const res = await look(code);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ participantCount: 0, maxParticipants: 10 });
  });

  it("комнату потерял LiveKit (перезапуск) — она есть, внутри никого", async () => {
    const { code } = await newRoom();
    await lk.deleteRoom(code);
    const res = await look(code);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ participantCount: 0, participants: [] });
  });

  it("нет комнаты или кривой код — ROOM_NOT_FOUND в формате v2", async () => {
    for (const code of ["ZZZZZZ", "ab:cd"]) {
      const res = await look(code);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "ROOM_NOT_FOUND", message: expect.any(String) });
    }
  });

  it("лимит частоты на IP+комнату — RATE_LIMITED с retryAfterSec", async () => {
    const { code } = await newRoom();
    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 12 });
    const res = await look(code);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 12 });
    expect(h.consume).toHaveBeenLastCalledWith(expect.anything(), `local:${code}`);
  });

  it("Redis недоступен — SERVICE_UNAVAILABLE", async () => {
    const { code } = await newRoom();
    h.redis = new Proxy(
      {},
      {
        get: () => () => {
          throw Object.assign(new Error("down"), { name: "UpstashError" });
        },
      },
    );
    const res = await look(code);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
