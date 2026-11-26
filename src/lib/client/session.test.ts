import { describe, expect, it } from "vitest";
import { DisconnectReason } from "livekit-client";
import type { TokenResponse } from "@/lib/api/contract";
import {
  INITIAL_SESSION,
  REJOIN_DELAYS_MS,
  canRetryFrom,
  classifyDisconnect,
  isRejoining,
  rejoinDelayMs,
  sessionReducer,
  shouldConnect,
  type Refusal,
  type SessionEvent,
  type SessionState,
} from "./session";

const join = (token: string): TokenResponse => ({
  token,
  serverUrl: "ws://lk",
  identity: "u_me",
  name: "Саня",
  isHost: false,
  isOwner: false,
  room: {
    v: 2,
    title: "Вечерняя катка",
    isPublic: false,
    createdAt: 1,
    hostIdentity: null,
    hostName: null,
    ownerIdentity: null,
    locked: false,
    hasPassword: false,
    settings: { screen: "all", chat: "all" },
  },
});

const refusal = (code: Refusal["code"], retryAfterSec?: number): Refusal => ({
  code,
  message: `текст ${code}`,
  ...(retryAfterSec ? { retryAfterSec } : {}),
});

function run(events: SessionEvent[], from: SessionState = INITIAL_SESSION): SessionState {
  return events.reduce(sessionReducer, from);
}

const drop = (now = 1000): SessionEvent => ({ type: "disconnected", kind: { kind: "drop" }, now });

describe("classifyDisconnect", () => {
  it("свой выход не трогаем", () => {
    expect(classifyDisconnect(DisconnectReason.CLIENT_INITIATED)).toEqual({ kind: "ignore" });
  });

  it("вторая вкладка", () => {
    expect(classifyDisconnect(DisconnectReason.DUPLICATE_IDENTITY)).toEqual({ kind: "duplicate" });
  });

  it("удаление хостом — с причиной из metadata или без неё", () => {
    expect(
      classifyDisconnect(DisconnectReason.PARTICIPANT_REMOVED, { reason: "kick", retryAfterSec: 300 }),
    ).toEqual({ kind: "removed", reason: "kick", retryAfterSec: 300 });
    expect(classifyDisconnect(DisconnectReason.PARTICIPANT_REMOVED)).toEqual({
      kind: "removed",
      reason: null,
    });
  });

  it("сеть, перезапуск сервера и потерянная комната — входим заново", () => {
    for (const r of [
      undefined,
      DisconnectReason.UNKNOWN_REASON,
      DisconnectReason.SERVER_SHUTDOWN,
      DisconnectReason.ROOM_DELETED,
      DisconnectReason.SIGNAL_CLOSE,
      DisconnectReason.JOIN_FAILURE,
    ]) {
      expect(classifyDisconnect(r)).toEqual({ kind: "drop" });
    }
  });
});

describe("rejoinDelayMs", () => {
  it("идёт по расписанию и кончается", () => {
    expect(rejoinDelayMs(0)).toBe(0);
    expect(rejoinDelayMs(1)).toBe(REJOIN_DELAYS_MS[1]);
    expect(rejoinDelayMs(REJOIN_DELAYS_MS.length)).toBeNull();
    expect(rejoinDelayMs(-1)).toBeNull();
  });

  it("ждёт не меньше, чем просит сервер", () => {
    expect(rejoinDelayMs(0, 7)).toBe(7000);
    expect(rejoinDelayMs(4, 1)).toBe(REJOIN_DELAYS_MS[4]);
  });
});

describe("sessionReducer: вход и связь", () => {
  it("лобби → подключение → на связи", () => {
    const s = run([{ type: "joined", join: join("t1") }, { type: "connected" }]);
    expect(s).toEqual({ stage: "room", join: join("t1"), link: { phase: "live" } });
    expect(shouldConnect(s)).toBe(true);
    expect(isRejoining(s)).toBe(false);
  });

  it("первый вход не удался — экран «не получилось подключиться к голосу»", () => {
    const s = run([{ type: "joined", join: join("t1") }, drop()]);
    expect(s).toMatchObject({ stage: "ended", screen: { kind: "voice" } });
  });

  it("обрыв после входа — сразу пробуем войти заново со свежим токеном", () => {
    const live = run([{ type: "joined", join: join("t1") }, { type: "connected" }]);
    const waiting = sessionReducer(live, drop(5000));
    expect(waiting).toMatchObject({ stage: "room", link: { phase: "waiting", attempt: 0, at: 5000 } });
    expect(isRejoining(waiting)).toBe(true);
    expect(shouldConnect(waiting)).toBe(false);

    const requesting = sessionReducer(waiting, { type: "retry", now: 5000 });
    expect(requesting).toMatchObject({ link: { phase: "requesting", attempt: 0 } });

    const connecting = sessionReducer(requesting, { type: "token", join: join("t2") });
    expect(connecting).toEqual({ stage: "room", join: join("t2"), link: { phase: "connecting", rejoin: 0 } });
    expect(shouldConnect(connecting)).toBe(true);
    expect(isRejoining(connecting)).toBe(true);

    const back = sessionReducer(connecting, { type: "connected" });
    expect(back).toEqual({ stage: "room", join: join("t2"), link: { phase: "live" } });
  });

  it("повторный вход не подключился — следующая попытка позже", () => {
    const s = run([
      { type: "joined", join: join("t1") },
      { type: "connected" },
      drop(0),
      { type: "retry", now: 0 },
      { type: "token", join: join("t2") },
      drop(100),
    ]);
    expect(s).toMatchObject({ link: { phase: "waiting", attempt: 1, at: 100 + REJOIN_DELAYS_MS[1] } });
  });

  it("сеть не отвечает — паузы растут, потом «Связь потеряна»", () => {
    let s = run([{ type: "joined", join: join("t1") }, { type: "connected" }, drop(0)]);
    for (let i = 0; i < REJOIN_DELAYS_MS.length; i++) {
      s = sessionReducer(s, { type: "retry", now: 0 });
      s = sessionReducer(s, { type: "tokenError", error: refusal("NETWORK"), now: 0 });
    }
    expect(s).toMatchObject({ stage: "ended", screen: { kind: "lost" }, join: join("t1") });
  });

  it("сервер просит подождать — ждём не меньше", () => {
    const s = run([
      { type: "joined", join: join("t1") },
      { type: "connected" },
      drop(0),
      { type: "retry", now: 0 },
      { type: "tokenError", error: refusal("RATE_LIMITED", 9), now: 1000 },
    ]);
    expect(s).toMatchObject({ link: { phase: "waiting", attempt: 1, at: 1000 + 9000 } });
  });

  it("повтор события обрыва во время паузы ничего не ломает", () => {
    const waiting = run([{ type: "joined", join: join("t1") }, { type: "connected" }, drop(0)]);
    expect(sessionReducer(waiting, drop(50))).toBe(waiting);
    expect(sessionReducer(waiting, { type: "connected" })).toMatchObject({ link: { phase: "live" } });
  });

  it("свой выход (CLIENT_INITIATED) ничего не меняет", () => {
    const live = run([{ type: "joined", join: join("t1") }, { type: "connected" }]);
    expect(sessionReducer(live, { type: "disconnected", kind: { kind: "ignore" }, now: 0 })).toBe(live);
  });
});

describe("sessionReducer: финальные экраны", () => {
  const live = run([{ type: "joined", join: join("t1") }, { type: "connected" }]);

  it("кик — экран с отсчётом; вернуться можно только после него", () => {
    const s = sessionReducer(live, {
      type: "disconnected",
      kind: { kind: "removed", reason: "kick", retryAfterSec: 300 },
      now: 10_000,
    });
    expect(s).toMatchObject({ stage: "ended", screen: { kind: "removed", reason: "kick", until: 310_000 } });
    if (s.stage !== "ended") throw new Error("ожидался финальный экран");
    expect(canRetryFrom(s.screen, 309_999)).toBe(false);
    expect(sessionReducer(s, { type: "retry", now: 100_000 })).toBe(s);
    expect(canRetryFrom(s.screen, 310_000)).toBe(true);
    expect(sessionReducer(s, { type: "retry", now: 310_000 })).toMatchObject({ retrying: true });
  });

  it("администрация: выгнали на время — вернуться после отсчёта; бан и закрытие — нет", () => {
    const kicked = sessionReducer(live, {
      type: "disconnected",
      kind: { kind: "removed", reason: "admin_kick", retryAfterSec: 60 },
      now: 0,
    });
    if (kicked.stage !== "ended") throw new Error("ожидался финальный экран");
    expect(canRetryFrom(kicked.screen, 59_999)).toBe(false);
    expect(canRetryFrom(kicked.screen, 60_000)).toBe(true);
    for (const reason of ["admin_ban", "admin_close"] as const) {
      const s = sessionReducer(live, { type: "disconnected", kind: { kind: "removed", reason }, now: 0 });
      if (s.stage !== "ended") throw new Error("ожидался финальный экран");
      expect(canRetryFrom(s.screen, Number.MAX_SAFE_INTEGER)).toBe(false);
    }
  });

  it("бан — без возврата", () => {
    const s = sessionReducer(live, {
      type: "disconnected",
      kind: { kind: "removed", reason: "ban" },
      now: 0,
    });
    expect(s).toMatchObject({ screen: { kind: "removed", reason: "ban", until: null } });
    if (s.stage !== "ended") throw new Error("ожидался финальный экран");
    expect(canRetryFrom(s.screen, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("вторая вкладка → «Вернуться сюда» входит заново", () => {
    const dup = sessionReducer(live, { type: "disconnected", kind: { kind: "duplicate" }, now: 0 });
    expect(dup).toMatchObject({ stage: "ended", screen: { kind: "duplicate" } });
    const retrying = sessionReducer(dup, { type: "retry", now: 0 });
    expect(retrying).toMatchObject({ stage: "ended", retrying: true });
    expect(sessionReducer(retrying, { type: "token", join: join("t9") })).toEqual({
      stage: "room",
      join: join("t9"),
      link: { phase: "connecting", rejoin: 0 },
    });
  });

  it("кнопка на «Связь потеряна» без сети — остаёмся на экране с ошибкой", () => {
    let s = run([drop(0)], live);
    for (let i = 0; i < REJOIN_DELAYS_MS.length; i++) {
      s = sessionReducer(s, { type: "retry", now: 0 });
      s = sessionReducer(s, { type: "tokenError", error: refusal("NETWORK"), now: 0 });
    }
    s = sessionReducer(s, { type: "retry", now: 0 });
    s = sessionReducer(s, { type: "tokenError", error: refusal("NETWORK"), now: 0 });
    expect(s).toMatchObject({ stage: "ended", screen: { kind: "lost" }, retrying: false, error: { code: "NETWORK" } });
  });

  it("отказы при входе заново ведут на свои экраны", () => {
    const requesting = run([drop(0), { type: "retry", now: 0 }], live);
    const after = (code: Refusal["code"], sec?: number) =>
      sessionReducer(requesting, { type: "tokenError", error: refusal(code, sec), now: 1000 });

    expect(after("ROOM_NOT_FOUND")).toMatchObject({ stage: "ended", screen: { kind: "closed" }, error: null });
    expect(after("KICKED", 60)).toMatchObject({ screen: { kind: "removed", reason: "kick", until: 61_000 } });
    expect(after("BANNED")).toMatchObject({ screen: { kind: "removed", reason: "ban" } });
    expect(after("ROOM_LOCKED")).toMatchObject({ screen: { kind: "refused", error: { code: "ROOM_LOCKED" } } });
    expect(after("ROOM_FULL")).toMatchObject({ screen: { kind: "refused", error: { code: "ROOM_FULL" } } });
  });

  it("сменился пароль или ник занят — назад в лобби с причиной", () => {
    const requesting = run([drop(0), { type: "retry", now: 0 }], live);
    expect(
      sessionReducer(requesting, { type: "tokenError", error: refusal("WRONG_PASSWORD"), now: 0 }),
    ).toEqual({ stage: "lobby", notice: refusal("WRONG_PASSWORD") });
    expect(
      sessionReducer(requesting, { type: "tokenError", error: refusal("NAME_TAKEN"), now: 0 }),
    ).toMatchObject({ stage: "lobby", notice: { code: "NAME_TAKEN" } });
  });

  it("с экрана «комнаты нет» и «устаревший клиент» повтора нет", () => {
    expect(canRetryFrom({ kind: "closed" }, 0)).toBe(false);
    expect(canRetryFrom({ kind: "refused", error: refusal("CLIENT_OUTDATED") }, 0)).toBe(false);
    expect(canRetryFrom({ kind: "refused", error: refusal("ROOM_FULL") }, 0)).toBe(true);
    expect(canRetryFrom({ kind: "lost" }, 0)).toBe(true);
  });

  it("ответ на устаревший запрос токена игнорируется", () => {
    expect(sessionReducer(live, { type: "token", join: join("t5") })).toBe(live);
    expect(sessionReducer(live, { type: "tokenError", error: refusal("NETWORK"), now: 0 })).toBe(live);
  });
});

describe("sessionReducer: «Вы вышли»", () => {
  const live = run([{ type: "joined", join: join("t1") }, { type: "connected" }]);
  const left = sessionReducer(live, { type: "left" });

  it("«Выйти» — экран «Вы вышли» с последним входом; свой обрыв LiveKit его не трогает", () => {
    expect(left).toEqual({ stage: "ended", screen: { kind: "left" }, join: join("t1"), retrying: false, error: null });
    expect(shouldConnect(left)).toBe(false);
    const ignored = sessionReducer(left, { type: "disconnected", kind: { kind: "ignore" }, now: 0 });
    expect(ignored).toBe(left);
  });

  it("«Вернуться» входит заново без лобби и без «Переподключаемся…»", () => {
    expect(canRetryFrom({ kind: "left" }, 0)).toBe(true);
    const retrying = sessionReducer(left, { type: "retry", now: 0 });
    expect(retrying).toMatchObject({ stage: "ended", screen: { kind: "left" }, retrying: true });
    const back = sessionReducer(retrying, { type: "token", join: join("t2") });
    expect(back).toEqual({ stage: "room", join: join("t2"), link: { phase: "connecting", rejoin: null } });
    expect(isRejoining(back)).toBe(false);
  });

  it("пока выходили, сменили пароль — в лобби с причиной; закрыли вход — свой экран", () => {
    const retrying = sessionReducer(left, { type: "retry", now: 0 });
    expect(sessionReducer(retrying, { type: "tokenError", error: refusal("WRONG_PASSWORD"), now: 0 })).toEqual({
      stage: "lobby",
      notice: refusal("WRONG_PASSWORD"),
    });
    expect(
      sessionReducer(retrying, { type: "tokenError", error: refusal("ROOM_LOCKED"), now: 0 }),
    ).toMatchObject({ stage: "ended", screen: { kind: "refused", error: { code: "ROOM_LOCKED" } } });
  });

  it("нет сети — остаёмся на «Вы вышли» с ошибкой", () => {
    const retrying = sessionReducer(left, { type: "retry", now: 0 });
    expect(sessionReducer(retrying, { type: "tokenError", error: refusal("NETWORK"), now: 0 })).toMatchObject({
      stage: "ended",
      screen: { kind: "left" },
      retrying: false,
      error: { code: "NETWORK" },
    });
  });

  it("«Выйти» вне комнаты ничего не меняет", () => {
    expect(sessionReducer(INITIAL_SESSION, { type: "left" })).toBe(INITIAL_SESSION);
    expect(sessionReducer(left, { type: "left" })).toBe(left);
  });
});
