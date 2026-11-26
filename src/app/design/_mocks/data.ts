// Моковые данные для макетов. Имена — как у настоящей компании друзей, цвета
// раздаёт assignAvatarColors — так же, как в комнате.

import { assignAvatarColors } from "@/components/ui/avatarColor";
import type { AvatarStatus } from "@/components/ui/Avatar";
import type { ConnectionQuality } from "@/components/ui/SignalBars";

export const ROOM = {
  title: "Вечерняя катка",
  code: "K7QMP4",
  link: "club.game-room.space/room/K7QMP4",
};

export type MockPerson = {
  id: string;
  name: string;
  me?: boolean;
  host?: boolean;
  speaking?: boolean;
  level?: number;
  status?: AvatarStatus | null;
  streaming?: boolean;
  quality: ConnectionQuality;
  ping: number;
  colorIndex: number;
};

const RAW: Omit<MockPerson, "colorIndex">[] = [
  { id: "tema", name: "Тёма", host: true, speaking: true, level: 0.85, quality: "excellent", ping: 38, streaming: true },
  { id: "nika", name: "Ника", quality: "good", ping: 61 },
  { id: "leha", name: "Лёха", status: "muted", quality: "excellent", ping: 44 },
  { id: "dania", name: "Даня Котов", status: "deafened", quality: "poor", ping: 182 },
  { id: "sania", name: "Саня", me: true, quality: "excellent", ping: 42 },
];

const COLORS = assignAvatarColors(RAW.map((p) => p.name));

export const PEOPLE: MockPerson[] = RAW.map((p, i) => ({ ...p, colorIndex: COLORS[i] }));

export const ME = PEOPLE.find((p) => p.me)!;

export const CHAT = [
  { id: "1", who: "Тёма", time: "21:02", text: "го ещё одну, пока Лёха не ушёл" },
  { id: "2", who: "Тёма", time: "21:02", text: "лобби: https://steamcommunity.com/joinlobby/730/1093" },
  { id: "3", who: "Ника", time: "21:03", text: "я за, только звук подкручу" },
  { id: "4", who: "Лёха", time: "21:05", text: "секунду, чай" },
  { id: "5", who: "Саня", time: "21:06", text: "кто в пати, жмите принять", mine: true },
  { id: "6", who: "Даня Котов", time: "21:06", text: "у меня пинг 180, клуб опять тупит" },
  { id: "7", who: "Саня", time: "21:07", text: "даня, перезайди по ссылке", mine: true, failed: true },
];

export function personByName(name: string): MockPerson | undefined {
  return PEOPLE.find((p) => p.name === name);
}
