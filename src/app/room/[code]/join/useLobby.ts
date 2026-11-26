"use client";

import { useCallback, useEffect, useState } from "react";
import type { PreviewResponse, TokenResponse } from "@/lib/api/contract";
import { checkNickname } from "@/lib/api/nickname";
import { getHostKey, getNickname, setNickname } from "@/lib/clientStorage";
import { getRoomPreview, requestToken } from "@/lib/client/api";
import { getDeviceIdentity } from "@/lib/client/device";
import { ApiError, isAbortError, networkError } from "@/lib/client/errors";
import {
  classifyJoinFailure,
  type FormProblem,
  type JoinFailure,
  type ScreenView,
} from "@/lib/client/joinScreens";
import type { Refusal } from "@/lib/client/session";
import { persistentKey, usePersistentState } from "../state/usePersistentState";
import { useHasHostKey } from "../state/useRoomMeta";
import { wrongPasswordText } from "./lobbyTexts";

/** Чем входили — этим же входим заново после обрыва (пароль — только в памяти вкладки). */
export type JoinCredentials = { name: string; password?: string };

export type PreviewState =
  | { status: "loading" }
  | { status: "ready"; room: PreviewResponse }
  /** Превью не загрузилось не по вине комнаты (сеть): лобби работает без него. */
  | { status: "unavailable" };

export type Lobby = {
  preview: PreviewState;
  /** Ник в поле (сохранённый, пока человек не начал печатать). */
  name: string;
  setName: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  /** Показывать поле пароля. Владельцу с ключом пароль не нужен. */
  needsPassword: boolean;
  /** Подсказка у поля или над кнопкой. */
  problem: FormProblem | null;
  /** Экран вместо формы: комнаты нет, полна, выгнали… */
  screen: ScreenView | null;
  /** До этого момента «Войти» заблокирована (сервер просит подождать). */
  waitUntil: number | null;
  busy: boolean;
  /** В этом браузере есть ключ владельца. */
  isOwner: boolean;
  /** Войти (форма, «Попробовать снова» на экране). Звать из обработчика клика. */
  submit: () => void;
};

// Ник переживает перезагрузку (gr.nickname). На сервере его нет — первым кадром
// поле пустое, потом подставится сохранённый.
const nicknamePref = persistentKey<string | null>({
  read: getNickname,
  write: (nick) => {
    if (nick) setNickname(nick);
  },
  initial: null,
});

// Подсказки под полем «Ваш ник» — о чём речь, и так видно.
const NAME_PROBLEM = {
  empty: "Введите ник",
  too_short: "Нужно хотя бы 2 символа",
  too_long: "Не больше 24 символов",
} as const;

const toRefusal = (err: unknown): Refusal => (err instanceof ApiError ? err : networkError());

/** Отказ → подсказка у поля или экран. У неверного пароля остаток называем, только когда он мал. */
function failureOf(refusal: Refusal, now: number): JoinFailure {
  const failure = classifyJoinFailure(refusal, now);
  if (failure.type !== "form" || refusal.code !== "WRONG_PASSWORD") return failure;
  const message = wrongPasswordText(refusal.attemptsLeft, refusal.message);
  return { ...failure, problem: { ...failure.problem, message } };
}

/**
 * Лобби перед входом: превью комнаты, ник, пароль и сам вход (POST /api/token).
 * beforeJoin зовётся синхронно в обработчике клика — это жест пользователя,
 * в нём разблокируется звук и готовится комната LiveKit. onJoined — токен получен.
 * notice — почему вернули в лобби из комнаты (например, сменился пароль).
 */
export function useLobby({
  code,
  notice,
  beforeJoin,
  onJoined,
}: {
  code: string;
  notice: Refusal | null;
  beforeJoin: () => void;
  onJoined: (join: TokenResponse, credentials: JoinCredentials, preview: PreviewResponse | null) => void;
}): Lobby {
  const [savedName] = usePersistentState(nicknamePref);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [previewTick, setPreviewTick] = useState(0);
  // Сервер сам попросил пароль (превью не знало или его поставили, пока нас не было).
  const [askedPassword, setAskedPassword] = useState(
    () =>
      notice?.code === "PASSWORD_REQUIRED" ||
      notice?.code === "WRONG_PASSWORD" ||
      notice?.code === "TOO_MANY_ATTEMPTS",
  );
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [failure, setFailure] = useState<JoinFailure | null>(() => (notice ? failureOf(notice, Date.now()) : null));
  const isOwner = useHasHostKey(code);
  const name = draftName ?? savedName ?? "";

  // Превью: при входе на страницу и когда вкладку снова открыли (состав мог смениться).
  useEffect(() => {
    const ctrl = new AbortController();
    getRoomPreview(code, ctrl.signal).then(
      (room) => setPreview({ status: "ready", room }),
      (err: unknown) => {
        if (isAbortError(err)) return;
        if (toRefusal(err).code === "ROOM_NOT_FOUND") {
          setFailure({ type: "screen", screen: { kind: "notFound" } });
        } else {
          // Без превью лобби всё равно работает: вход сам скажет, что не так.
          setPreview((p) => (p.status === "ready" ? p : { status: "unavailable" }));
        }
      },
    );
    return () => ctrl.abort();
  }, [code, previewTick]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setPreviewTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const roomHasPassword = preview.status === "ready" && preview.room.hasPassword;
  const needsPassword = askedPassword || (roomHasPassword && !isOwner);

  const submit = useCallback(() => {
    if (busy) return;
    if (waitUntil !== null && Date.now() < waitUntil) return;
    const nick = checkNickname(name);
    if (!nick.ok) {
      setFailure({ type: "form", problem: { field: "name", message: NAME_PROBLEM[nick.reason] } });
      return;
    }
    const pw = password.trim();
    if (needsPassword && !pw) {
      setFailure({ type: "form", problem: { field: "password", message: "Введите пароль комнаты" } });
      return;
    }
    // Жест пользователя: звук и комната готовятся здесь, до ожидания сети.
    beforeJoin();
    nicknamePref.set(nick.name);
    setBusy(true);
    setFailure(null);
    const credentials: JoinCredentials = { name: nick.name, password: needsPassword ? pw : undefined };
    requestToken({
      code,
      name: nick.name,
      device: getDeviceIdentity(),
      password: credentials.password,
      hostKey: getHostKey(code),
    }).then(
      (join) => {
        setBusy(false);
        onJoined(join, credentials, preview.status === "ready" ? preview.room : null);
      },
      (err: unknown) => {
        setBusy(false);
        const refusal = toRefusal(err);
        const next = failureOf(refusal, Date.now());
        if (refusal.code === "PASSWORD_REQUIRED") setAskedPassword(true);
        setWaitUntil(next.type === "form" ? (next.waitUntil ?? null) : null);
        setFailure(next);
      },
    );
  }, [busy, waitUntil, name, password, needsPassword, beforeJoin, code, onJoined, preview]);

  return {
    preview,
    name,
    setName: (v) => {
      setDraftName(v);
      if (failure?.type === "form" && failure.problem.field === "name") setFailure(null);
    },
    password,
    setPassword: (v) => {
      setPassword(v);
      if (failure?.type === "form" && failure.problem.field === "password") setFailure(null);
    },
    needsPassword,
    problem: failure?.type === "form" ? failure.problem : null,
    screen: failure?.type === "screen" ? failure.screen : null,
    waitUntil,
    busy,
    isOwner,
    submit,
  };
}
