"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  useIsSpeaking as useLiveKitIsSpeaking,
  useRoomContext,
} from "@livekit/components-react";
import { RoomEvent, type Participant } from "livekit-client";
import { speakingStore } from "@/lib/audio/speaking";

// «Кто говорит» для колец и плиток. Сначала — свой детектор на клиенте
// (@/lib/audio/speaking): у других по уровню принятого звука, у себя по порогу
// шумодава. Мгновенно, без задержки сервера. Нет своего источника (дорожка ещё
// не подключена, обработка не запустилась) — признак LiveKit с сервера.
//
// Подписка — на одного участника: голос Тёмы перерисовывает только место Тёмы.

function useOwnSignal<T>(identity: string, read: (identity: string) => T, server: T): T {
  const subscribe = useCallback((cb: () => void) => speakingStore.subscribe(identity, cb), [identity]);
  return useSyncExternalStore(subscribe, () => read(identity), () => server);
}

/** Говорит ли участник прямо сейчас. */
export function useIsSpeaking(participant: Participant): boolean {
  const own = useOwnSignal(participant.identity, (id) => speakingStore.speaking(id), null);
  const server = useLiveKitIsSpeaking(participant);
  return own ?? server;
}

/**
 * Сила голоса 0…1 для кольца (шаг 0,1). Свой детектор обновляет её ≈20 раз в
 * секунду только пока человек говорит; без него — participant.audioLevel LiveKit.
 */
export function useAudioLevel(participant: Participant): number {
  const own = useOwnSignal(participant.identity, (id) => speakingStore.level(id), null);
  const room = useRoomContext();
  // Пока есть свой детектор, события LiveKit не слушаем — лишних перерисовок нет.
  const hasOwn = own !== null;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (hasOwn) return () => {};
      room.on(RoomEvent.ActiveSpeakersChanged, onChange);
      return () => {
        room.off(RoomEvent.ActiveSpeakersChanged, onChange);
      };
    },
    [room, hasOwn],
  );
  const server = useSyncExternalStore(
    subscribe,
    () => participant.audioLevel,
    () => 0,
  );
  return own ?? server;
}
