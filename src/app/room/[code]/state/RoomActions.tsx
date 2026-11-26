"use client";

import { createContext, use, useCallback, useMemo, type ReactNode } from "react";
import { playSfx } from "@/lib/audio/sfx";
import { useDeafen } from "../audio/useDeafen";
import { useMic } from "../audio/useMic";
import { useChatPanel } from "../chat/useChatPanel";
import { useSettingsDialog, type SettingsTab } from "../settings/useSettingsDialog";
import { useScreenShareControl } from "../stage/useScreenShareControl";

/**
 * Действия пользователя в комнате — одни и те же функции для дока и горячих
 * клавиш. Каждое озвучено в месте вызова (а не по смене состояния): так нет
 * ложных звуков на авто-публикацию микрофона при входе и авто-раскрытие экрана.
 * Аргументы событий не принимают — в onClick оборачивайте стрелкой.
 */
export type RoomActions = {
  /** Микрофон вкл/выкл (в режиме рации — сама рация). Заглушён хостом — ничего. */
  toggleMic: () => void;
  /** «Звук выкл» вкл/выкл — как в Discord, глушит и свой микрофон. */
  toggleDeafen: () => void;
  /**
   * Своя демонстрация экрана вкл/выкл (профиль качества — из настроек). Звуки
   * начала и конца — по факту, а не здесь: показ кончается и из панели браузера.
   */
  toggleScreenShare: () => void;
  /** Открыть окно настроек на вкладке (по умолчанию — «Голос»). */
  openSettings: (tab?: SettingsTab) => void;
  /** Выйти из комнаты на главную. */
  leave: () => void;
  /** Панель чата открыть/закрыть со звуком (кнопка дока). */
  toggleChat: () => void;
  /** Открыть чат без звука (горячая клавиша). */
  openChat: () => void;
};

const RoomActionsContext = createContext<RoomActions | null>(null);

/** Собирает действия из областей: микрофон, звук, экран, настройки, чат. */
export function RoomActionsProvider({
  onLeave,
  children,
}: {
  onLeave: () => void;
  children: ReactNode;
}) {
  const { toggle: toggleMic } = useMic();
  const { toggle: toggleDeafen } = useDeafen();
  const { toggle: toggleScreenShare } = useScreenShareControl();
  const { openSettings } = useSettingsDialog();
  const { toggle: toggleChat, openPanel: openChat } = useChatPanel();
  const leave = useCallback(() => {
    playSfx("leave");
    onLeave();
  }, [onLeave]);

  const value = useMemo<RoomActions>(
    () => ({ toggleMic, toggleDeafen, toggleScreenShare, openSettings, leave, toggleChat, openChat }),
    [toggleMic, toggleDeafen, toggleScreenShare, openSettings, leave, toggleChat, openChat],
  );
  return <RoomActionsContext value={value}>{children}</RoomActionsContext>;
}

export function useRoomActions(): RoomActions {
  const value = use(RoomActionsContext);
  if (!value) throw new Error("useRoomActions: нет RoomActionsProvider выше по дереву");
  return value;
}
