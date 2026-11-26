"use client";

import { useCallback } from "react";
import { getHostKey } from "@/lib/clientStorage";
import { useRoomSession } from "../state/RoomSession";
import { useModeration } from "../state/useModeration";
import { useHasHostKey, useRoomMeta } from "../state/useRoomMeta";
import { openRoomSettings } from "./roomSettingsStore";

export type HostActions = {
  /** Я сейчас хост. */
  amHost: boolean;
  /** Я владелец без прав хоста — могу вернуть их себе. */
  canReclaim: boolean;
  /** Вход закрыт. */
  locked: boolean;
  /** Закрыть или открыть вход (только хост). */
  toggleLock: () => void;
  /** Владелец возвращает права хоста себе. */
  reclaim: () => void;
  /** Открыть диалог «Настройки комнаты». */
  openRoomSettings: () => void;
};

/** Действия хоста и владельца для меню названия комнаты в шапке. */
export function useHostActions(): HostActions {
  const { amHost, amOwner, locked } = useRoomMeta();
  const { code } = useRoomSession();
  const hasHostKey = useHasHostKey(code);
  const { moderate } = useModeration();

  const toggleLock = useCallback(() => {
    void moderate({ action: "settings", settings: { locked: !locked } });
  }, [moderate, locked]);

  // Владельца сервер узнаёт по identity; ключ шлём на случай, если владелец
  // вошёл с другого устройства (тогда identity не совпадёт, а ключ — да).
  const reclaim = useCallback(() => {
    void moderate({ action: "reclaim", hostKey: getHostKey(code) });
  }, [moderate, code]);

  return {
    amHost,
    canReclaim: !amHost && (amOwner || hasHostKey),
    locked,
    toggleLock,
    reclaim,
    openRoomSettings,
  };
}
