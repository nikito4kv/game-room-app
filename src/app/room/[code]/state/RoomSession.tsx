"use client";

import { createContext, use, type ReactNode } from "react";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

/**
 * Текущий вход в комнату (ответ POST /api/token). После обрыва мы входим заново
 * со свежим токеном — тогда token меняется, остальное обычно то же.
 */
export type RoomSession = {
  /** Код комнаты (верхний регистр). */
  code: string;
  /** Название из ответа /api/token. Свежее (из metadata комнаты) — useRoomMeta().title. */
  title: string;
  /** Свой LiveKit-токен: им же авторизуемся в /api/moderate и /api/chat. */
  token: string;
  /** Своя identity ("u_" + id устройства). */
  identity: string;
  /** Свой ник после чистки сервером. */
  name: string;
  /** Вошли с ключом владельца. */
  isOwner: boolean;
  /** Связь оборвалась окончательно, и мы сами входим заново со свежим токеном. */
  rejoining: boolean;
};

const RoomSessionContext = createContext<RoomSession | null>(null);

export function RoomSessionProvider({
  session,
  children,
}: {
  session: RoomSession;
  children: ReactNode;
}) {
  return <RoomSessionContext value={session}>{children}</RoomSessionContext>;
}

export function useRoomSession(): RoomSession {
  const session = use(RoomSessionContext);
  if (!session) throw new Error("useRoomSession: нет RoomSessionProvider выше по дереву");
  return session;
}

/**
 * Связь с комнатой для интерфейса. reconnecting — нас сейчас не слышно: LiveKit
 * восстанавливает связь сам или мы входим заново после окончательного обрыва.
 * По нему — баннер «Переподключаемся…» и затемнённая зона комнаты.
 */
export function useRoomLink(): { reconnecting: boolean } {
  const state = useConnectionState();
  const { rejoining } = useRoomSession();
  return {
    reconnecting:
      rejoining ||
      state === ConnectionState.Reconnecting ||
      state === ConnectionState.SignalReconnecting,
  };
}
