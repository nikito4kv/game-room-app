"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  useLocalParticipantPermissions,
  useParticipantInfo,
  useRoomContext,
  useRoomInfo,
} from "@livekit/components-react";
import type { Participant } from "livekit-client";
import {
  DEFAULT_ROOM_SETTINGS,
  parseParticipantPublicMeta,
  parseRoomPublicMeta,
  type ParticipantPublicMeta,
  type RoomPublicMeta,
  type RoomSettings,
} from "@/lib/api/contract";
import { getHostKey } from "@/lib/clientStorage";
import { myAbilities, type MyAbilities } from "@/lib/client/permissions";
import { useRoomSession } from "./RoomSession";

export type RoomMeta = {
  /** Описание комнаты из room.metadata (пишет только сервер); нет или битое → null. */
  meta: RoomPublicMeta | null;
  /** Название: свежее из metadata, а пока её нет — из ответа /api/token. */
  title: string;
  hostIdentity: string | null;
  ownerIdentity: string | null;
  /** Вход закрыт для новых участников. */
  locked: boolean;
  /** Кто может показывать экран и писать в чат. */
  settings: RoomSettings;
  /** Хост сейчас — я. */
  amHost: boolean;
  /** Я владелец (создатель с ключом): могу вернуть права хоста в любой момент. */
  amOwner: boolean;
};

/**
 * Публичное описание комнаты (реактивно, по RoomMetadataChanged). Кто хост —
 * берём отсюда, а не из ответа на вход: так передача прав видна всем сразу.
 */
export function useRoomMeta(): RoomMeta {
  const { metadata } = useRoomInfo();
  const session = useRoomSession();
  const meta = useMemo(() => parseRoomPublicMeta(metadata), [metadata]);
  // identity — из сессии, а не из useLocalParticipant: тот перерисовывает на
  // каждое переключение своего микрофона, а identity устройства постоянна.
  const me = session.identity;
  const hostIdentity = meta?.hostIdentity ?? null;
  const ownerIdentity = meta?.ownerIdentity ?? null;
  return {
    meta,
    title: meta?.title ?? session.title,
    hostIdentity,
    ownerIdentity,
    locked: meta?.locked ?? false,
    settings: meta?.settings ?? DEFAULT_ROOM_SETTINGS,
    amHost: !!hostIdentity && hostIdentity === me,
    amOwner: ownerIdentity ? ownerIdentity === me : session.isOwner,
  };
}

/** Решения хоста об участнике (participant.metadata): мьют, запрет чата, разрешение экрана. */
export function useParticipantMeta(participant: Participant): ParticipantPublicMeta {
  const { metadata } = useParticipantInfo({ participant });
  return useMemo(() => parseParticipantPublicMeta(metadata), [metadata]);
}

/** Хост принудительно заглушил участника (микрофон и звук демонстрации). */
export function useForceMuted(participant: Participant): boolean {
  return useParticipantMeta(participant).forceMuted;
}

/** Что мне можно сейчас: микрофон, экран, чат — и почему нельзя (для подсказок). */
export function useMyPermissions(): MyAbilities {
  const permissions = useLocalParticipantPermissions();
  const { localParticipant } = useRoomContext();
  const { chatMuted } = useParticipantMeta(localParticipant);
  const { settings, amHost } = useRoomMeta();
  return useMemo(
    () => myAbilities({ permissions, settings, amHost, meta: { chatMuted } }),
    [permissions, settings, amHost, chatMuted],
  );
}

const noSubscribe = () => () => {};

/** Есть ли в этом браузере ключ владельца комнаты (выдан при создании). На сервере — false. */
export function useHasHostKey(code: string): boolean {
  return useSyncExternalStore(noSubscribe, () => !!getHostKey(code), () => false);
}
