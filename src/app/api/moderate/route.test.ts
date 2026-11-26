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
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));
vi.mock("@/lib/livekit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/livekit")>()),
  getRoomService: () => h.livekit,
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  consumeLimit: async () => ({ limited: false, remaining: 10 }),
  peekLimit: async () => ({ remaining: 20, retryAfterSec: 600 }),
}));

import {
  parseParticipantPublicMeta,
  parseRoomPublicMeta,
  type ApiErrorBody,
  type CreateRoomResponse,
  type ModerateResponse,
  type TokenResponse,
} from "@/lib/api/contract";
import { loadAuth, loadHostLeftAt, markHostLeft } from "@/lib/roomSecret";
import { POST as createRoom } from "../rooms/route";
import { POST as getToken } from "../token/route";
import { POST as moderate } from "./route";

const { MICROPHONE: MIC, SCREEN_SHARE: SCREEN, SCREEN_SHARE_AUDIO: SCREEN_AUDIO } = TrackSource;

let lk: FakeLiveKit;
let code: string;
let hostKey: string;
/** Токены: A — владелец (хост), B и C — гости. */
const tokens: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };

const device = (n: number) => ({ id: `device${n}`.padEnd(22, "x"), secret: "s".repeat(43) });
const id = (who: "A" | "B" | "C") => `u_${device({ A: 1, B: 2, C: 3 }[who]).id}`;

async function enter(name: string, n: number, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await readResponse<TokenResponse>(
    await getToken(jsonRequest("/api/token", { v: 2, code, name, device: device(n), ...extra })),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await connectWithToken(lk, res.body.token);
  return res.body.token;
}

function act(who: "A" | "B" | "C", command: Record<string, unknown>) {
  return moderate(jsonRequest("/api/moderate", { code, token: tokens[who], ...command })).then((r) =>
    readResponse<ModerateResponse & ApiErrorBody>(r),
  );
}

const roomMeta = () => parseRoomPublicMeta(lk.rooms.get(code)?.metadata);
const person = (who: "A" | "B" | "C") => lk.participants.get(code)?.get(id(who));

beforeAll(() => {
  applyTestEnv();
});

beforeEach(async () => {
  h.redis = new FakeRedis();
  lk = new FakeLiveKit();
  h.livekit = lk;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T20:00:00Z"));
  const created = await readResponse<CreateRoomResponse>(
    await createRoom(jsonRequest("/api/rooms", { title: "Комната" })),
  );
  ({ code, hostKey } = created.body);
  tokens.A = await enter("Аня", 1, { hostKey });
  tokens.B = await enter("Боря", 2);
  tokens.C = await enter("Вера", 3);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("авторизация", () => {
  it("гость не может модерировать — NOT_HOST", async () => {
    const res = await act("B", { action: "kick", target: id("C") });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_HOST");
  });

  it("чужой или битый токен — UNAUTHORIZED", async () => {
    const res = await readResponse<ApiErrorBody>(
      await moderate(jsonRequest("/api/moderate", { code, token: "мусор", action: "muteAll" })),
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("вызывающий не в комнате — NOT_IN_ROOM (старый токен не даёт власти)", async () => {
    lk.leave(code, id("A"));
    const res = await act("A", { action: "muteAll" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_IN_ROOM");
  });

  it("неизвестное действие — BAD_REQUEST", async () => {
    expect((await act("A", { action: "nuke" })).body.error.code).toBe("BAD_REQUEST");
  });
});

describe("владелец", () => {
  it("неуязвим для кика, бана, мьюта и запрета чата от другого хоста", async () => {
    await act("A", { action: "transfer", target: id("B") });
    for (const action of ["kick", "ban", "mute", "chatMute"]) {
      const res = await act("B", { action, target: id("A") });
      expect(res.body.error.code, action).toBe("TARGET_IS_OWNER");
    }
    expect(person("A")).toBeDefined();
  });

  it("всегда может вернуть права (reclaim), даже у присутствующего хоста", async () => {
    await act("A", { action: "transfer", target: id("B") });
    expect(roomMeta()?.hostIdentity).toBe(id("B"));
    const res = await act("A", { action: "reclaim" });
    expect(res.status).toBe(200);
    expect(roomMeta()?.hostIdentity).toBe(id("A"));
  });

  it("не владелец — NOT_OWNER; с ключом владельца — можно", async () => {
    expect((await act("C", { action: "reclaim" })).body.error.code).toBe("NOT_OWNER");
    const res = await act("C", { action: "reclaim", hostKey });
    expect(res.status).toBe(200);
    expect(roomMeta()).toMatchObject({ hostIdentity: id("C"), ownerIdentity: id("C") });
  });
});

describe("передача и авто-передача прав", () => {
  it("передача снимает с нового хоста принудительный мьют и даёт ему микрофон", async () => {
    await act("A", { action: "mute", target: id("B") });
    expect(person("B")?.permission.canPublishSources).not.toContain(MIC);
    const res = await act("A", { action: "transfer", target: id("B") });
    expect(res.status).toBe(200);
    expect(roomMeta()).toMatchObject({ hostIdentity: id("B"), hostName: "Боря" });
    expect(person("B")?.permission.canPublishSources).toContain(MIC);
    expect(parseParticipantPublicMeta(person("B")?.metadata).forceMuted).toBe(false);
  });

  it("передать можно только присутствующему и не себе", async () => {
    lk.leave(code, id("C"));
    expect((await act("A", { action: "transfer", target: id("C") })).body.error.code).toBe("TARGET_NOT_FOUND");
    expect((await act("A", { action: "transfer", target: id("A") })).body.error.code).toBe("TARGET_IS_SELF");
  });

  it("хост ушёл: claim раньше 30 с — ждать; после — место занято; хост на месте — HOST_PRESENT", async () => {
    expect((await act("B", { action: "claim" })).body.error.code).toBe("HOST_PRESENT");

    lk.leave(code, id("A"));
    await markHostLeft(code, Date.now()); // это пишет вебхук participant_left
    vi.setSystemTime(Date.now() + 10_000);
    const early = await act("B", { action: "claim" });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "HOST_HANDOVER_PENDING", retryAfterSec: 20 });

    vi.setSystemTime(Date.now() + 20_000);
    expect((await act("B", { action: "claim" })).status).toBe(200);
    expect(roomMeta()?.hostIdentity).toBe(id("B"));
    expect(await loadHostLeftAt(code)).toBeNull();
    // Второй претендент опоздал.
    expect((await act("C", { action: "claim" })).body.error.code).toBe("HOST_PRESENT");
  });

  it("отметки ухода нет (вебхук потерялся) — отсчёт начинается с первой попытки", async () => {
    lk.leave(code, id("A"));
    const first = await act("B", { action: "claim" });
    expect(first.body.error).toMatchObject({ code: "HOST_HANDOVER_PENDING", retryAfterSec: 30 });
    vi.setSystemTime(Date.now() + 30_000);
    expect((await act("B", { action: "claim" })).status).toBe(200);
  });

  it("хост вернулся до конца паузы — права остаются у него", async () => {
    lk.leave(code, id("A"));
    await markHostLeft(code, Date.now());
    vi.setSystemTime(Date.now() + 15_000);
    await connectWithToken(lk, tokens.A); // вернулся тем же устройством
    vi.setSystemTime(Date.now() + 20_000);
    expect((await act("B", { action: "claim" })).body.error.code).toBe("HOST_PRESENT");
    expect(roomMeta()?.hostIdentity).toBe(id("A"));
  });
});

describe("права по настройкам комнаты", () => {
  it("экран «только хост»: у гостей отзывается право, идущая демонстрация снимается", async () => {
    expect(lk.publish(code, id("B"), SCREEN)).not.toBeNull();
    const res = await act("A", { action: "settings", settings: { screen: "host" } });
    expect(res.status).toBe(200);
    expect(person("B")?.permission.canPublishSources).toEqual([MIC]);
    expect(person("B")?.tracks).toEqual([]);
    expect(person("A")?.permission.canPublishSources).toEqual([MIC, SCREEN, SCREEN_AUDIO]);
    expect(roomMeta()?.settings.screen).toBe("host");
  });

  it("экран «по разрешению»: разрешённому — можно, остальным — нет", async () => {
    await act("A", { action: "settings", settings: { screen: "approved" } });
    await act("A", { action: "allowScreen", target: id("B") });
    expect(person("B")?.permission.canPublishSources).toEqual([MIC, SCREEN, SCREEN_AUDIO]);
    expect(parseParticipantPublicMeta(person("B")?.metadata).screenAllowed).toBe(true);
    expect(person("C")?.permission.canPublishSources).toEqual([MIC]);
    await act("A", { action: "disallowScreen", target: id("B") });
    expect(person("B")?.permission.canPublishSources).toEqual([MIC]);
  });

  it("неизвестный режим — BAD_REQUEST; пустые настройки — BAD_REQUEST", async () => {
    expect((await act("A", { action: "settings", settings: { screen: "everyone" } })).body.error.code).toBe(
      "BAD_REQUEST",
    );
    expect((await act("A", { action: "settings", settings: {} })).body.error.code).toBe("BAD_REQUEST");
  });

  it("пароль: задать (минимум 4 символа) и снять; видно только «есть пароль»", async () => {
    expect((await act("A", { action: "settings", settings: { password: "123" } })).body.error.code).toBe(
      "INVALID_PASSWORD",
    );
    await act("A", { action: "settings", settings: { password: "1234" } });
    expect(roomMeta()?.hasPassword).toBe(true);
    expect((await loadAuth(code))?.passwordHash).toMatch(/:/);
    expect(lk.rooms.get(code)?.metadata).not.toContain("1234");
    await act("A", { action: "settings", settings: { password: null } });
    expect(roomMeta()?.hasPassword).toBe(false);
  });

  it("витрина и замок", async () => {
    await act("A", { action: "settings", settings: { isPublic: true, locked: true, chat: "host" } });
    expect(roomMeta()).toMatchObject({ isPublic: true, locked: true, settings: { chat: "host" } });
  });
});

describe("мьют и экран участника", () => {
  it("принудительный мьют закрывает микрофон и звук демонстрации, снимает трек", async () => {
    lk.publish(code, id("B"), MIC);
    await act("A", { action: "mute", target: id("B") });
    expect(person("B")?.permission.canPublishSources).toEqual([SCREEN]);
    expect(person("B")?.tracks).toEqual([]);
    expect(parseParticipantPublicMeta(person("B")?.metadata).forceMuted).toBe(true);
    await act("A", { action: "unmute", target: id("B") });
    expect(person("B")?.permission.canPublishSources).toEqual([MIC, SCREEN, SCREEN_AUDIO]);
  });

  it("мьют переживает перезаход: токен уже без микрофона", async () => {
    await act("A", { action: "mute", target: id("B") });
    lk.leave(code, id("B"));
    const res = await readResponse<TokenResponse>(
      await getToken(jsonRequest("/api/token", { v: 2, code, name: "Боря", device: device(2) })),
    );
    const p = await connectWithToken(lk, res.body.token);
    expect(p.permission.canPublishSources).toEqual([SCREEN]);
  });

  it("«заглушить всех» — мягко, кроме себя и владельца", async () => {
    await act("A", { action: "transfer", target: id("B") });
    for (const who of ["A", "B", "C"] as const) lk.publish(code, id(who), MIC);
    const res = await act("B", { action: "muteAll" });
    expect(res.status).toBe(200);
    expect(lk.mutedTracks.map((m) => m.identity)).toEqual([id("C")]);
    // Право на микрофон не отбиралось — включить снова можно самому.
    expect(person("C")?.permission.canPublishSources).toContain(MIC);
  });

  it("остановить чужую демонстрацию: трек снят, право показывать вернулось", async () => {
    lk.publish(code, id("B"), SCREEN);
    lk.publish(code, id("B"), SCREEN_AUDIO);
    const res = await act("A", { action: "stopScreen", target: id("B") });
    expect(res.status).toBe(200);
    expect(person("B")?.tracks).toEqual([]);
    expect(person("B")?.permission.canPublishSources).toEqual([MIC, SCREEN, SCREEN_AUDIO]);
  });

  it("запрет чата отражается в metadata участника", async () => {
    await act("A", { action: "chatMute", target: id("C") });
    expect(parseParticipantPublicMeta(person("C")?.metadata).chatMuted).toBe(true);
    await act("A", { action: "chatUnmute", target: id("C") });
    expect(parseParticipantPublicMeta(person("C")?.metadata).chatMuted).toBe(false);
  });
});

describe("кик и баны", () => {
  it("кикнутый сначала получает причину в metadata, затем отключается", async () => {
    await act("A", { action: "kick", target: id("B") });
    const reason = lk.updateCalls.filter((u) => u.identity === id("B")).at(-1);
    expect(parseParticipantPublicMeta(reason?.metadata).removed).toEqual({ reason: "kick", retryAfterSec: 300 });
    expect(person("B")).toBeUndefined();
  });

  it("список банов с никами; разбан убирает из списка", async () => {
    await act("A", { action: "ban", target: id("B") });
    const list = await act("A", { action: "bans" });
    expect(list.body).toEqual({ ok: true, bans: [{ identity: id("B"), name: "Боря" }] });
    await act("A", { action: "unban", target: id("B") });
    expect((await act("A", { action: "bans" })).body.bans).toEqual([]);
  });

  it("недавно вышедшего можно забанить; незнакомца — нет", async () => {
    lk.leave(code, id("C"));
    expect((await act("A", { action: "ban", target: id("C") })).status).toBe(200);
    expect((await act("A", { action: "ban", target: "u_stranger_xxxxxxxxxxx" })).body.error.code).toBe(
      "TARGET_NOT_FOUND",
    );
  });

  it("кикнуть или заглушить себя нельзя", async () => {
    expect((await act("A", { action: "kick", target: id("A") })).body.error.code).toBe("TARGET_IS_SELF");
  });
});

describe("запрос клиента прежней версии", () => {
  it("callerToken вместо token — UNAUTHORIZED, действие не выполняется", async () => {
    const res = await readResponse<ApiErrorBody>(
      await moderate(jsonRequest("/api/moderate", { code, callerToken: tokens.A, action: "lock" })),
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(roomMeta()?.locked).toBe(false);
  });
});
