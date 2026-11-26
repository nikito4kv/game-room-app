"use client";

import { createContext, use, useCallback, useMemo, type ReactNode } from "react";
import type { ModerateResponse, ModerationAction, ModerationCommand } from "@/lib/api/contract";
import { toast } from "@/components/ui";
import { playSfx } from "@/lib/audio/sfx";
import { moderate as callModerate } from "@/lib/client/api";
import { ApiError, networkError } from "@/lib/client/errors";
import { useRoomSession } from "./RoomSession";

export type ModerationResult =
  | { ok: true; response: ModerateResponse }
  | { ok: false; error: ApiError };

export type Moderation = {
  /**
   * Действие хоста или владельца через /api/moderate. Отказ показываем тостом с
   * текстом сервера и тревожным звуком; silent — без них (фоновые действия,
   * например авто-передача хоста).
   */
  moderate: (command: ModerationCommand, options?: { silent?: boolean }) => Promise<ModerationResult>;
};

/** Заголовок тоста об ошибке: что именно не получилось. Текст причины — от сервера. */
const FAILURE_TITLE: Record<ModerationAction, string> = {
  kick: "Не получилось выгнать",
  ban: "Не получилось забанить",
  unban: "Не получилось разбанить",
  bans: "Не получилось загрузить список банов",
  mute: "Не получилось выключить микрофон",
  unmute: "Не получилось вернуть микрофон",
  muteAll: "Не получилось выключить микрофоны",
  stopScreen: "Не получилось остановить показ",
  allowScreen: "Не получилось разрешить показ экрана",
  disallowScreen: "Не получилось запретить показ экрана",
  chatMute: "Не получилось запретить чат",
  chatUnmute: "Не получилось разрешить чат",
  transfer: "Не получилось передать права",
  reclaim: "Не получилось вернуть права хоста",
  claim: "Не получилось занять место хоста",
  // Настройки комнаты применяются сразу: при отказе переключатель возвращается назад.
  settings: "Не получилось изменить настройки комнаты",
};

const ModerationContext = createContext<Moderation | null>(null);

/** Модерация: один запрос и один вид ошибки для меню участника, шапки и настроек комнаты. */
export function ModerationProvider({ children }: { children: ReactNode }) {
  const { code, token } = useRoomSession();
  const moderate = useCallback(
    async (command: ModerationCommand, options?: { silent?: boolean }): Promise<ModerationResult> => {
      try {
        return { ok: true, response: await callModerate(code, token, command) };
      } catch (err) {
        const error = err instanceof ApiError ? err : networkError();
        if (!options?.silent) {
          playSfx("mod-error", { urgent: true });
          toast({
            id: `moderation-${command.action}`,
            tone: "alert",
            title: FAILURE_TITLE[command.action],
            description: error.message,
          });
        }
        return { ok: false, error };
      }
    },
    [code, token],
  );
  const value = useMemo(() => ({ moderate }), [moderate]);
  return <ModerationContext value={value}>{children}</ModerationContext>;
}

export function useModeration(): Moderation {
  const value = use(ModerationContext);
  if (!value) throw new Error("useModeration: нет ModerationProvider выше по дереву");
  return value;
}
