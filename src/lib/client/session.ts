// Жизнь подключения к комнате после лобби — чистая машина состояний без React,
// сети и таймеров (их запускает хук комнаты по состоянию отсюда).
//
//   лобби ──токен──▶ комната: connecting ──Connected──▶ live
//                         ▲            │                  │ окончательный обрыв
//                         │            ▼ (первый вход)    ▼
//                         │       экран «голос»      waiting ──пора──▶ requesting
//                         └──────────── новый токен ◀───────────────────┘
//   Попытки кончились → экран «Связь потеряна». Кик, бан, вторая вкладка — свои экраны.
//
// Короткие обрывы LiveKit чинит сам (состояние Reconnecting, своя политика
// повторов — ROOM_RECONNECT_DELAYS_MS). Сюда попадаем, когда он сдался: тогда
// входим заново через POST /api/token со свежим токеном (сервер заодно
// пересоздаст комнату, если LiveKit её потерял).
import { DisconnectReason } from "livekit-client";
import type { ParticipantPublicMeta, RemovalReason, TokenResponse } from "@/lib/api/contract";
import type { ClientErrorCode } from "./errors";

/**
 * Паузы между попытками LiveKit восстановить связь, мс: ~2,5 мин вместо ~50 с
 * по умолчанию. Короткий провал Wi-Fi в клубе или переключение сети не должны
 * выкидывать из комнаты. После каждой паузы (кроме первых двух) LiveKit
 * добавляет случайные 0–1 с.
 */
export const ROOM_RECONNECT_DELAYS_MS: readonly number[] = [
  0, 300, 1_200, 2_700, 4_800, 7_000, 7_000, 7_000, 7_000, 7_000, 10_000, 10_000, 10_000, 10_000,
  10_000, 15_000, 15_000, 15_000,
];

/** Паузы перед нашими попытками войти заново со свежим токеном, мс (~1 мин в сумме). */
export const REJOIN_DELAYS_MS: readonly number[] = [0, 2_000, 5_000, 10_000, 20_000, 30_000];

/**
 * Пауза перед попыткой номер attempt (с нуля). Сервер просит подождать
 * (Retry-After) — ждём не меньше. null — попытки кончились.
 */
export function rejoinDelayMs(attempt: number, retryAfterSec?: number): number | null {
  if (attempt < 0 || attempt >= REJOIN_DELAYS_MS.length) return null;
  return Math.max(REJOIN_DELAYS_MS[attempt], (retryAfterSec ?? 0) * 1000);
}

/** Отказ сервера в форме, пригодной для экрана (ApiError подходит как есть). */
export type Refusal = {
  code: ClientErrorCode;
  message: string;
  retryAfterSec?: number;
  attemptsLeft?: number | null;
  suggestion?: string;
};

/** Что значит окончательный обрыв (RoomEvent.Disconnected). */
export type DisconnectKind =
  /** Отключились сами: выход из комнаты (или dev-режим React пересоздал подключение). */
  | { kind: "ignore" }
  /** Сервер удалил нас: причина — из своей metadata (removed), если она успела прийти. */
  | { kind: "removed"; reason: RemovalReason | null; retryAfterSec?: number }
  /** С этого же устройства вошли в другой вкладке — LiveKit выбил это подключение. */
  | { kind: "duplicate" }
  /** Всё остальное: сеть, перезапуск или потеря комнаты сервером — входим заново. */
  | { kind: "drop" };

export function classifyDisconnect(
  reason: DisconnectReason | undefined,
  removed?: ParticipantPublicMeta["removed"],
): DisconnectKind {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return { kind: "ignore" };
    case DisconnectReason.DUPLICATE_IDENTITY:
      return { kind: "duplicate" };
    case DisconnectReason.PARTICIPANT_REMOVED:
      return removed
        ? { kind: "removed", reason: removed.reason, retryAfterSec: removed.retryAfterSec }
        : { kind: "removed", reason: null };
    default:
      // ROOM_DELETED тоже сюда: сервер пересоздаёт комнату из своего хранилища,
      // а если её правда больше нет — вход ответит ROOM_NOT_FOUND.
      return { kind: "drop" };
  }
}

/** Связь с комнатой, пока мы «в комнате». */
export type Link =
  /** Ждём подключения LiveKit. rejoin — номер попытки входа заново; null — первый вход. */
  | { phase: "connecting"; rejoin: number | null }
  | { phase: "live" }
  /** Пауза перед попыткой войти заново — до момента at (мс эпохи). */
  | { phase: "waiting"; attempt: number; at: number }
  /** Идёт запрос свежего токена. */
  | { phase: "requesting"; attempt: number };

/** Финальные экраны. */
export type EndScreen =
  /**
   * Сервер удалил: kick и admin_kick — с отсчётом до until (мс эпохи), ban, locked,
   * admin_ban, admin_close; null — причина неизвестна.
   */
  | { kind: "removed"; reason: RemovalReason | null; until: number | null }
  | { kind: "duplicate" }
  /** Сами вернуться не смогли. */
  | { kind: "lost" }
  /** Не подключились к голосу с первого раза (UDP закрыт, VPN). */
  | { kind: "voice" }
  /** Комнаты больше нет (вход заново ответил ROOM_NOT_FOUND). */
  | { kind: "closed" }
  /** Сервер не пустил обратно: замок, комната полна, место занято, старый клиент… */
  | { kind: "refused"; error: Refusal }
  /**
   * Вышли сами («Выйти»): экран «Вы вышли» с «Вернуться». Промахнуться мимо
   * кнопки в клубе легко — вернуться можно сразу, без лобби.
   */
  | { kind: "left" };

export type SessionState =
  /** Лобби. notice — почему вернули сюда (например, хост сменил пароль). */
  | { stage: "lobby"; notice: Refusal | null }
  | { stage: "room"; join: TokenResponse; link: Link }
  /**
   * Финальный экран. join — последний вход (им же входим заново по кнопке);
   * retrying — идёт запрос токена по кнопке; error — почему кнопка не помогла.
   */
  | { stage: "ended"; screen: EndScreen; join: TokenResponse | null; retrying: boolean; error: Refusal | null };

export type SessionEvent =
  /** Лобби получило токен. */
  | { type: "joined"; join: TokenResponse }
  /** LiveKit подключился (RoomEvent.Connected). */
  | { type: "connected" }
  /** LiveKit отключился окончательно (RoomEvent.Disconnected). */
  | { type: "disconnected"; kind: DisconnectKind; now: number }
  /** Пора пробовать: таймер вышел, сеть вернулась, вкладку открыли или нажали кнопку. */
  | { type: "retry"; now: number }
  /** Запрос токена удался. */
  | { type: "token"; join: TokenResponse }
  /** Запрос токена не удался. */
  | { type: "tokenError"; error: Refusal; now: number }
  /** Человек нажал «Выйти». */
  | { type: "left" };

export const INITIAL_SESSION: SessionState = { stage: "lobby", notice: null };

/** Отказы, которые лечит сам человек в лобби: ник, пароль. */
const NEEDS_INPUT: ReadonlySet<ClientErrorCode> = new Set<ClientErrorCode>([
  "PASSWORD_REQUIRED",
  "WRONG_PASSWORD",
  "TOO_MANY_ATTEMPTS",
  "NAME_TAKEN",
  "INVALID_NAME",
]);

/** Сбой, который проходит сам: повторяем по расписанию. */
const TRANSIENT: ReadonlySet<ClientErrorCode> = new Set<ClientErrorCode>([
  "NETWORK",
  "SERVICE_UNAVAILABLE",
  "SERVER_ERROR",
  "RATE_LIMITED",
]);

function waitOrLost(
  join: TokenResponse,
  attempt: number,
  now: number,
  retryAfterSec?: number,
): SessionState {
  const delay = rejoinDelayMs(attempt, retryAfterSec);
  if (delay === null) return ended({ kind: "lost" }, join);
  return { stage: "room", join, link: { phase: "waiting", attempt, at: now + delay } };
}

function ended(screen: EndScreen, join: TokenResponse | null, error: Refusal | null = null): SessionState {
  return { stage: "ended", screen, join, retrying: false, error };
}

/** Экран по окончательному отказу сервера при входе заново. */
function refusalScreen(error: Refusal, now: number): EndScreen {
  switch (error.code) {
    case "ROOM_NOT_FOUND":
      return { kind: "closed" };
    case "KICKED":
      return {
        kind: "removed",
        reason: "kick",
        until: error.retryAfterSec ? now + error.retryAfterSec * 1000 : null,
      };
    case "BANNED":
      return { kind: "removed", reason: "ban", until: null };
    default:
      return { kind: "refused", error };
  }
}

/** Можно ли уже нажимать «вернуться» на финальном экране. */
export function canRetryFrom(screen: EndScreen, now: number): boolean {
  switch (screen.kind) {
    case "removed":
      return (
        (screen.reason === "kick" || screen.reason === "admin_kick") && screen.until !== null && now >= screen.until
      );
    case "closed":
      return false;
    case "refused":
      return screen.error.code !== "CLIENT_OUTDATED";
    default:
      return true;
  }
}

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "joined":
      return { stage: "room", join: event.join, link: { phase: "connecting", rejoin: null } };

    case "connected":
      if (state.stage !== "room" || state.link.phase === "live") return state;
      return { ...state, link: { phase: "live" } };

    case "disconnected": {
      if (state.stage !== "room") return state;
      const { kind } = event;
      switch (kind.kind) {
        case "ignore":
          return state;
        case "removed":
          return ended(
            {
              kind: "removed",
              reason: kind.reason,
              until: kind.retryAfterSec ? event.now + kind.retryAfterSec * 1000 : null,
            },
            state.join,
          );
        case "duplicate":
          return ended({ kind: "duplicate" }, state.join);
        case "drop": {
          const { link } = state;
          if (link.phase === "live") return waitOrLost(state.join, 0, event.now);
          if (link.phase === "connecting") {
            return link.rejoin === null
              ? ended({ kind: "voice" }, state.join)
              : waitOrLost(state.join, link.rejoin + 1, event.now);
          }
          // Пока ждём или просим токен, LiveKit и так отключён — повтор события.
          return state;
        }
      }
      return state;
    }

    case "retry":
      if (state.stage === "room" && state.link.phase === "waiting") {
        return { ...state, link: { phase: "requesting", attempt: state.link.attempt } };
      }
      if (state.stage === "ended" && !state.retrying && state.join && canRetryFrom(state.screen, event.now)) {
        return { ...state, retrying: true, error: null };
      }
      return state;

    case "token":
      if (state.stage === "room" && state.link.phase === "requesting") {
        return { stage: "room", join: event.join, link: { phase: "connecting", rejoin: state.link.attempt } };
      }
      if (state.stage === "ended" && state.retrying) {
        // «Вернуться» после своего выхода — обычный вход (без «Переподключаемся…»),
        // остальные экраны — вход заново после сбоя.
        const rejoin = state.screen.kind === "left" ? null : 0;
        return { stage: "room", join: event.join, link: { phase: "connecting", rejoin } };
      }
      return state;

    case "left":
      // Ушли сами. Связь LiveKit рвёт размонтирование комнаты (его Disconnected —
      // «сами», игнорируется), вход заново — только по кнопке.
      if (state.stage !== "room") return state;
      return ended({ kind: "left" }, state.join);

    case "tokenError": {
      const { error, now } = event;
      const requesting = state.stage === "room" && state.link.phase === "requesting";
      const retrying = state.stage === "ended" && state.retrying;
      if (!requesting && !retrying) return state;
      if (NEEDS_INPUT.has(error.code)) return { stage: "lobby", notice: error };
      if (TRANSIENT.has(error.code)) {
        if (state.stage === "ended") return { ...state, retrying: false, error };
        if (state.link.phase === "requesting") {
          return waitOrLost(state.join, state.link.attempt + 1, now, error.retryAfterSec);
        }
        return state;
      }
      // Причину отказа экран говорит сам (заголовок и текст) — без повтора ошибкой.
      return ended(refusalScreen(error, now), state.join);
    }
  }
}

/** Пока входим заново, интерфейс показывает «Переподключаемся…» и затемняет комнату. */
export function isRejoining(state: SessionState): boolean {
  if (state.stage !== "room") return false;
  const { link } = state;
  return link.phase === "waiting" || link.phase === "requesting" || (link.phase === "connecting" && link.rejoin !== null);
}

/** Должен ли LiveKit сейчас быть подключён (проп connect у <LiveKitRoom>). */
export function shouldConnect(state: SessionState): boolean {
  return state.stage === "room" && (state.link.phase === "connecting" || state.link.phase === "live");
}
