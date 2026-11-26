// Витрина открытых комнат (/rooms): фильтр, поиск и подписи — чистые функции
// (тест рядом). Данные — GET /api/rooms (PublicRoomSummary).

import { MAX_PARTICIPANTS, type PublicRoomSummary } from "@/lib/api/contract";
import { plural } from "@/lib/plural";

export type RoomFilter = "all" | "open" | "password";

/** Что мешает войти. Порядок важен: замок важнее заполненности, та — пароля. */
export type RoomStatus = "locked" | "full" | "password" | "open";

/** Сколько мест в комнате. 0 у LiveKit значит «без лимита» — тогда лимит сайта. */
export function roomCapacity(room: PublicRoomSummary): number {
  return room.maxParticipants > 0 ? room.maxParticipants : MAX_PARTICIPANTS;
}

export function roomStatus(room: PublicRoomSummary): RoomStatus {
  if (room.locked) return "locked";
  if (room.numParticipants >= roomCapacity(room)) return "full";
  if (room.hasPassword) return "password";
  return "open";
}

function matches(room: PublicRoomSummary, query: string): boolean {
  if (!query) return true;
  const haystack = `${room.title}\n${room.hostName}\n${room.code}`.toLocaleLowerCase("ru");
  return haystack.includes(query);
}

/**
 * Комнаты под фильтр и поиск. «Без пароля» — те, куда можно зайти сразу;
 * «С паролем» — куда можно зайти, зная пароль. Запертые и полные видны только
 * во «Все». Поиск — по названию, нику хоста и коду, без учёта регистра.
 */
export function filterRooms(
  rooms: readonly PublicRoomSummary[],
  filter: RoomFilter,
  query: string,
): PublicRoomSummary[] {
  const q = query.trim().toLocaleLowerCase("ru");
  return rooms.filter((room) => {
    const status = roomStatus(room);
    if (filter === "open" && status !== "open") return false;
    if (filter === "password" && status !== "password") return false;
    return matches(room, q);
  });
}

/** «3 комнаты · 9 человек» — по всему списку, до фильтра. */
export function roomsSummary(rooms: readonly PublicRoomSummary[]): string {
  const people = rooms.reduce((sum, r) => sum + Math.max(0, r.numParticipants), 0);
  return (
    `${rooms.length} ${plural(rooms.length, ["комната", "комнаты", "комнат"])} · ` +
    `${people} ${plural(people, ["человек", "человека", "человек"])}`
  );
}

/** Подпись строки для скринридера: всё состояние одной фразой. */
export function roomRowLabel(room: PublicRoomSummary): string {
  const parts = [room.title];
  if (room.badge) parts.push(`клуб ${room.badge.label}`);
  if (room.hostName) parts.push(`хост ${room.hostName}`);
  parts.push(`${room.numParticipants} из ${roomCapacity(room)}`);
  const status = roomStatus(room);
  if (status === "locked") parts.push("вход закрыт");
  else if (status === "full") parts.push("мест нет");
  else if (status === "password") parts.push("нужен пароль");
  return parts.join(", ");
}
