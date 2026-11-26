"use client";

import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type Participant, type RemoteParticipant } from "livekit-client";
import { createRecapTracker, type Recap, type RecapTracker } from "@/lib/room/recap";
import { readGameData } from "../games/useGameFeed";
import { displayName } from "../participants/useAvatarColors";
import { readReactionData, readSoundData } from "../reactions/feed";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomSession } from "../state/RoomSession";
import { useRoomMeta } from "../state/useRoomMeta";

// Счётчик вечера живёт дольше комнаты на экране: после «Выйти» экран «Вы вышли»
// показывает итоги, а «Вернуться» продолжает тот же вечер. Один на вкладку —
// другая комната начинает новый.
let current: { code: string; tracker: RecapTracker } | null = null;

/** Итоги вечера в этой комнате на момент now; не были в ней — null. */
export function recapSnapshot(code: string, now: number): Recap | null {
  return current?.code === code ? current.tracker.snapshot(now) : null;
}

/**
 * Считает «Итоги вечера», пока вы в комнате (@/lib/room/recap): кто входил и
 * выходил, кто говорит — по ActiveSpeakersChanged от LiveKit (приходит и в
 * фоновую вкладку), реакции, звуки и кубик — по тем же data-пакетам сервера, что
 * видят все. Ничего не рисует и не перерисовывает.
 */
export function useRecapTracker(): void {
  const room = useRoomContext();
  const { code } = useRoomSession();
  const { title } = useRoomMeta();
  const titleRef = useLatestRef(title);

  useEffect(() => {
    const now = Date.now();
    if (current?.code !== code) current = { code, tracker: createRecapTracker(titleRef.current, now) };
    const t = current.tracker;
    t.resume(now);
    const join = (p: Participant) => t.join(p.identity, displayName(p), Date.now());
    join(room.localParticipant);
    for (const p of room.remoteParticipants.values()) join(p);

    const onLeft = (p: RemoteParticipant) => t.leave(p.identity, Date.now());
    const onSpeakers = (speakers: Participant[]) =>
      t.speakers(
        speakers.map((p) => p.identity),
        Date.now(),
      );
    const onName = (_name: string, p?: Participant) => p && join(p);
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (readReactionData(payload, participant, topic)) t.reaction();
      else if (readSoundData(payload, participant, topic)) t.sound();
      else if (readGameData(payload, participant, topic)?.kind === "dice") t.dice();
    };
    room
      .on(RoomEvent.ParticipantConnected, join)
      .on(RoomEvent.ParticipantDisconnected, onLeft)
      .on(RoomEvent.ActiveSpeakersChanged, onSpeakers)
      .on(RoomEvent.ParticipantNameChanged, onName)
      .on(RoomEvent.DataReceived, onData);
    return () => {
      room
        .off(RoomEvent.ParticipantConnected, join)
        .off(RoomEvent.ParticipantDisconnected, onLeft)
        .off(RoomEvent.ActiveSpeakersChanged, onSpeakers)
        .off(RoomEvent.ParticipantNameChanged, onName)
        .off(RoomEvent.DataReceived, onData);
      t.pause(Date.now());
    };
  }, [room, code, titleRef]);

  useEffect(() => {
    if (current?.code === code) current.tracker.setTitle(title);
  }, [code, title]);
}
