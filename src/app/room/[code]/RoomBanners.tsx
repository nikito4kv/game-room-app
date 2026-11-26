"use client";

import { useState } from "react";
import { Button, InlineAlert } from "@/components/ui";
import { useMic } from "./audio/useMic";
import { useChatPanel } from "./chat/useChatPanel";
import { useRoomLink } from "./state/RoomSession";
import { useMyPermissions } from "./state/useRoomMeta";

/**
 * Полоса связи под шапкой — во всю ширину, над зоной комнаты и чатом. Видна,
 * пока нас не слышно: LiveKit восстанавливает связь сам или мы входим заново.
 * Комната при этом остаётся на месте (затемнение зоны — useRoomLink у раскладки).
 */
export function ConnectionBanner() {
  const { reconnecting } = useRoomLink();
  if (!reconnecting) return null;
  return (
    <div
      role="status"
      data-testid="reconnect-banner"
      className="flex shrink-0 items-center justify-center gap-2.5 border-b border-caution/25 bg-caution-wash px-4 py-2 text-body text-ink"
    >
      <span className="size-2 shrink-0 rounded-full bg-caution" aria-hidden="true" />
      Связь прервалась. Переподключаемся…
      <span className="text-ink-3 max-sm:hidden">Вас пока не слышно</span>
    </div>
  );
}

/**
 * Плашки над столом — пока причина есть (мимолётное — тостами): нет доступа к
 * микрофону, хост заглушил, хост выключил чат. Поводов нет — ничего не рисуем,
 * чтобы пустой блок не съедал место в раскладке.
 *
 * Всё, что значит «вас не слышно» (любая беда с микрофоном, мьют хостом), —
 * одного красного тона, как красная кнопка микрофона в доке (правило ДС).
 */
export default function RoomBanners() {
  const mic = useMic();
  const { chatHint } = useMyPermissions();
  const { open: chatOpen } = useChatPanel();
  // Про чат — справочно, его можно скрыть; новая причина покажет плашку снова.
  const [hiddenChatHint, setHiddenChatHint] = useState<string | null>(null);
  // Открытая панель чата сама пишет причину под полем ввода — плашка была бы дублем.
  const showChat = !!chatHint && chatHint !== hiddenChatHint && !chatOpen;

  if (!mic.error && !mic.forceMuted && !showChat) return null;

  return (
    <div className="flex w-full flex-col gap-2" data-testid="room-alerts">
      {mic.error && (
        <InlineAlert
          tone="alert"
          title={mic.error.title}
          action={
            <Button size="sm" variant="secondary" onClick={mic.retry}>
              Повторить
            </Button>
          }
        >
          {mic.error.description}
        </InlineAlert>
      )}
      {mic.forceMuted && (
        <InlineAlert tone="alert" title="Хост выключил ваш микрофон">
          Включить его снова может только хост.
        </InlineAlert>
      )}
      {showChat && (
        <InlineAlert tone="info" title={chatHint} onDismiss={() => setHiddenChatHint(chatHint)}>
          Голос и экран работают как обычно.
        </InlineAlert>
      )}
    </div>
  );
}
