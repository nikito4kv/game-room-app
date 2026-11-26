"use client";

import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type Participant, type RemoteParticipant } from "livekit-client";
import { avatarColorIndex, toast } from "@/components/ui";
import { GAME_TOPIC, READY_CHECK_MS, parseGamePacket, type GamePacket } from "@/lib/api/contract";
import { toastPerson } from "../feed/PersonHead";
import { displayName } from "../participants/useAvatarColors";
import { reactionStore } from "../reactions/reactionStore";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomSession } from "../state/RoomSession";
import { answerReady, diceBubble, readyText, tallyReady, type ReadyCheck } from "./view";
import { useSendGame } from "./useSendGame";

const decoder = new TextDecoder();

/** Data-пакет → игра или null. Только пакеты сервера (participant пустой) с темой GAME_TOPIC. */
export function readGameData(
  payload: Uint8Array,
  participant: object | null | undefined,
  topic: string | undefined,
): GamePacket | null {
  if (topic !== GAME_TOPIC || participant != null) return null;
  try {
    return parseGamePacket(JSON.parse(decoder.decode(payload)));
  } catch {
    return null;
  }
}

/**
 * Итоги игр у всех: значок над местом (🎲 с числом у бросившего, 🎯 у того, на
 * кого выпало, ✅ у ответившего «Готов») и тост с человеком. «Все готовы?» —
 * один тост на опрос: «Готовы 2 из 5» с кнопкой «Готов», пока вы не ответили;
 * ответили все или прошло 30 с — итог в том же тосте. Спросивший считается
 * готовым сразу. Тосты объявляет скринридеру их же live-область.
 */
export function useGameFeed({ colors }: { colors: ReadonlyMap<string, number> }): void {
  const room = useRoomContext();
  const { identity } = useRoomSession();
  const send = useSendGame();
  const colorsRef = useLatestRef(colors);
  const sendRef = useLatestRef(send);

  useEffect(() => {
    let check: ReadyCheck | null = null;
    let deadline = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Я нажал «Готов» (тост при этом закрылся) — промежуточные «Готовы N из M»
    // больше не всплывают, только итог.
    let answered = false;

    const participantOf = (id: string): Participant | null =>
      id === room.localParticipant.identity ? room.localParticipant : (room.getParticipantByIdentity(id) ?? null);
    const nameOf = (id: string) => {
      const p = participantOf(id);
      return p ? displayName(p) : "Участник";
    };
    const person = (id: string) => {
      const name = nameOf(id);
      return toastPerson(participantOf(id), name, colorsRef.current.get(id) ?? avatarColorIndex(name));
    };

    const showProgress = (c: ReadyCheck) => {
      if (answered) return;
      const text = readyText(tallyReady(c), nameOf, false);
      const mine = c.expected.includes(identity) && !c.answers.has(identity);
      toast({
        id: `ready-${c.id}`,
        title: text.title,
        description: `Спрашивает ${nameOf(c.asker)}. ${text.description}`,
        person: person(c.asker),
        action: mine
          ? {
              label: "Готов",
              onClick: () => {
                answered = true;
                sendRef.current({ action: "ready_answer", id: c.id, ready: true });
              },
            }
          : undefined,
        duration: Math.max(1_000, deadline - Date.now()),
        immediate: true,
      });
    };
    const finish = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const c = check;
      check = null;
      if (!c) return;
      const tally = tallyReady(c);
      const text = readyText(tally, nameOf, true);
      toast({
        id: `ready-${c.id}`,
        title: text.title,
        description: text.description,
        tone: tally.ready.length === c.expected.length ? "signal" : "neutral",
        immediate: true,
      });
    };

    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      const packet = readGameData(payload, participant, topic);
      if (!packet) return;
      switch (packet.kind) {
        case "dice": {
          const bubble = diceBubble(packet.value);
          reactionStore.show(packet.identity, bubble);
          toast({
            id: `game-dice-${packet.identity}`,
            title: nameOf(packet.identity),
            description: `бросает кубик: ${packet.value}`,
            person: person(packet.identity),
          });
          return;
        }
        case "pick": {
          reactionStore.show(packet.chosen, "picked");
          toast({
            id: "game-pick",
            title: "Кто платит?",
            description: packet.chosen === identity ? "Выпало на вас" : `Выпало: ${nameOf(packet.chosen)}`,
            person: person(packet.chosen),
          });
          return;
        }
        case "ready": {
          if (check) finish();
          const expected = [room.localParticipant.identity, ...room.remoteParticipants.keys()];
          if (!expected.includes(packet.identity)) expected.push(packet.identity);
          check = answerReady(
            { id: packet.id, asker: packet.identity, expected, answers: new Map() },
            packet.identity,
            true,
          );
          deadline = Date.now() + READY_CHECK_MS;
          // Спросивший готов сразу, но ход опроса видит (тост без кнопки).
          answered = false;
          reactionStore.show(packet.identity, "asked");
          timer = setTimeout(finish, READY_CHECK_MS);
          if (tallyReady(check).done) finish();
          else showProgress(check);
          return;
        }
        case "ready_answer": {
          if (!check || check.id !== packet.id) return;
          check = answerReady(check, packet.identity, packet.ready);
          reactionStore.show(packet.identity, packet.ready ? "ready" : "notReady");
          if (tallyReady(check).done) finish();
          else showProgress(check);
          return;
        }
      }
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      if (timer) clearTimeout(timer);
    };
  }, [room, identity, colorsRef, sendRef]);
}
