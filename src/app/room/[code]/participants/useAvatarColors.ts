"use client";

import { useMemo } from "react";
import { useRemoteParticipants, useRoomContext } from "@livekit/components-react";
import { RoomEvent, type Participant } from "livekit-client";
import { assignAvatarColors } from "@/components/ui";
import { sortByJoin } from "@/lib/room/seat";

/**
 * Кроме входа, выхода и смены связи (их список обновляет всегда) — только смена
 * ника. Голос, мьют, связь и права каждое место слушает само: так разговор не
 * перерисовывает всю комнату (аудит F-М6).
 */
const PEOPLE_EVENTS = [RoomEvent.ParticipantNameChanged];

/** Ник для подписей: имя из токена, а если его нет — identity. */
export function displayName(p: Participant): string {
  return p.name || p.identity;
}

/**
 * Все в комнате (я тоже) в порядке входа. Свой участник берётся из комнаты
 * напрямую, а не через useLocalParticipant: тот перерисовывает на каждое
 * переключение своего микрофона.
 */
export function usePeople(): Participant[] {
  const room = useRoomContext();
  const remotes = useRemoteParticipants({ updateOnlyOn: PEOPLE_EVENTS });
  return useMemo(() => sortByJoin([room.localParticipant, ...remotes]), [room, remotes]);
}

/** identity → индекс цвета. Цвета без повторов и одинаковые у всех клиентов. */
export function avatarColorMap(people: readonly Participant[]): ReadonlyMap<string, number> {
  const colors = assignAvatarColors(people.map(displayName));
  return new Map(people.map((p, i) => [p.identity, colors[i]]));
}

/**
 * Цвета аватаров комнаты: identity → индекс палитры (assignAvatarColors по нику
 * в порядке входа). Тем же цветом — имя в чате и аватар в тосте.
 */
export function useAvatarColors(): ReadonlyMap<string, number> {
  const people = usePeople();
  return useMemo(() => avatarColorMap(people), [people]);
}
