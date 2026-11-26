"use client";

import { useEffect, useReducer, useRef, type Dispatch, type RefObject } from "react";
import { getHostKey } from "@/lib/clientStorage";
import { requestToken } from "@/lib/client/api";
import { getDeviceIdentity } from "@/lib/client/device";
import { ApiError, isAbortError, networkError } from "@/lib/client/errors";
import {
  INITIAL_SESSION,
  sessionReducer,
  type SessionEvent,
  type SessionState,
} from "@/lib/client/session";
import type { JoinCredentials } from "./useLobby";

export type RoomConnection = {
  state: SessionState;
  dispatch: Dispatch<SessionEvent>;
  /** Ник и пароль последнего входа — ими входим заново. */
  credentialsRef: RefObject<JoinCredentials | null>;
};

/**
 * Запускает машину сессии (@/lib/client/session): таймеры пауз, запросы свежего
 * токена и «пора пробовать» по возвращению сети или вкладки. Сама логика
 * переходов — чистая и покрыта тестами; здесь только ввод-вывод.
 */
export function useRoomConnection(code: string): RoomConnection {
  const [state, dispatch] = useReducer(sessionReducer, INITIAL_SESSION);
  const credentialsRef = useRef<JoinCredentials | null>(null);

  // Пауза перед попыткой: таймер до назначенного времени; вернулась сеть или
  // вкладка (ноутбук открыли) — пробуем сразу, не дожидаясь таймера.
  const waitingAt = state.stage === "room" && state.link.phase === "waiting" ? state.link.at : null;
  useEffect(() => {
    if (waitingAt === null) return;
    const now = () => dispatch({ type: "retry", now: Date.now() });
    const timer = setTimeout(now, Math.max(0, waitingAt - Date.now()));
    const onVisible = () => {
      if (document.visibilityState === "visible") now();
    };
    window.addEventListener("online", now);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", now);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waitingAt]);

  // «Связь потеряна»: интернет вернулся — пробуем сами, без кнопки.
  const lost = state.stage === "ended" && state.screen.kind === "lost" && !state.retrying;
  useEffect(() => {
    if (!lost) return;
    const onOnline = () => dispatch({ type: "retry", now: Date.now() });
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [lost]);

  // Запрос свежего токена — при входе заново (сами или по кнопке).
  const requestKey =
    state.stage === "room" && state.link.phase === "requesting"
      ? `auto-${state.link.attempt}`
      : state.stage === "ended" && state.retrying
        ? "manual"
        : null;
  useEffect(() => {
    // Ник и пароль кладёт лобби до первого входа — без них в комнату не попасть.
    const creds = credentialsRef.current;
    if (requestKey === null || !creds) return;
    const ctrl = new AbortController();
    requestToken(
      {
        code,
        name: creds.name,
        device: getDeviceIdentity(),
        password: creds.password,
        hostKey: getHostKey(code),
      },
      ctrl.signal,
    ).then(
      (join) => dispatch({ type: "token", join }),
      (err: unknown) => {
        if (isAbortError(err)) return;
        const error = err instanceof ApiError ? err : networkError();
        dispatch({ type: "tokenError", error, now: Date.now() });
      },
    );
    return () => ctrl.abort();
  }, [requestKey, code]);

  return { state, dispatch, credentialsRef };
}
