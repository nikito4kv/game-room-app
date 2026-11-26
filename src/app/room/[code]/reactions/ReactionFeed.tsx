"use client";

import { useEffect, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { playBoardSound } from "@/lib/audio/soundboard";
import { useRoomSession } from "../state/RoomSession";
import { createReactionAnnouncer, readReactionData, readSoundData } from "./feed";
import { soundName } from "../sounds/catalog";
import { BUBBLE_VIEW } from "./gesture";
import { reactionStore } from "./reactionStore";

/** Сколько последних объявлений держать в live-области: старые убираем, это не озвучивается. */
const KEEP_LINES = 3;

type Line = { id: number; text: string };

/**
 * Приём реакций комнаты: data-пакеты с темой REACTION_TOPIC ТОЛЬКО от сервера
 * (readReactionData: пакет от участника — подделка). Пишет в reactionStore —
 * читают места за столом, сам ничего не перерисовывает. Звуки соундборда (тема
 * SOUND_TOPIC) — так же: значок звука всплывает над местом сыгравшего, сам звук
 * играет soundboard.ts (если человек не выключил у себя звуки других); своё эхо
 * пропускаем — свой звук сыгран по клику. Чужие реакции объявляет
 * скринридеру одной вежливой live-областью на комнату («Боря: огонь»): пузыри у
 * мест для него скрыты. Каждое объявление — новая строка, поэтому повтор той же
 * фразы тоже слышно; одного человека — не чаще раза в 2 с, лишнее склеивается
 * («Боря: огонь 3 раза»). Ушли из комнаты — реакции убираются.
 */
export default function ReactionFeed() {
  const room = useRoomContext();
  const { identity } = useRoomSession();
  const [lines, setLines] = useState<readonly Line[]>([]);
  // Ключи строк не повторяются и после переподписки: иначе React переиспользовал
  // бы узел и новая строка не прозвучала бы.
  const seq = useRef(0);

  useEffect(() => {
    const announcer = createReactionAnnouncer((text) => {
      const id = ++seq.current;
      setLines((prev) => [...prev.slice(1 - KEEP_LINES), { id, text }]);
    });
    const nameOf = (id: string) => room.getParticipantByIdentity(id)?.name || "Участник";
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      const packet = readReactionData(payload, participant, topic);
      if (packet) {
        if (!reactionStore.receive(packet, identity)) return;
        announcer.push(packet.identity, nameOf(packet.identity), BUBBLE_VIEW[packet.kind].spoken);
        return;
      }
      const sound = readSoundData(payload, participant, topic);
      if (!sound || sound.identity === identity) return;
      playBoardSound(sound.sound, sound.identity);
      reactionStore.show(sound.identity, "sound");
      announcer.push(sound.identity, nameOf(sound.identity), soundName(sound.sound));
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      announcer.clear();
    };
  }, [room, identity]);

  useEffect(() => () => reactionStore.clear(), []);

  return (
    <span aria-live="polite" aria-relevant="additions" data-testid="reactions-live" className="sr-only">
      {lines.map((l) => (
        <span key={l.id} className="block">
          {l.text}
        </span>
      ))}
    </span>
  );
}
