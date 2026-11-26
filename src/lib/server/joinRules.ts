// Правила входа в комнату — чистые функции без ввода-вывода. Маршрут /api/token
// собирает факты (Redis, LiveKit), а решают эти функции; так их легко проверить.
import { nicknameKey, suggestNickname } from "@/lib/api/nickname";
import type { ApiError } from "@/lib/api/contract";
import { apiError, nameTaken, retryError, roomFull } from "./errors";

export type PresentParticipant = { identity: string; name: string };

export type AdmissionInput = {
  identity: string;
  /** Ник после нормализации. */
  name: string;
  /** Предъявлен верный hostKey: владелец проходит мимо бана, кика и замка. */
  owner: boolean;
  /** "foreign" — место закреплено за другим устройством (другой secret). */
  seat: "ok" | "foreign";
  banned: boolean;
  /** Сколько секунд ещё действует кик; 0 — не кикнут. */
  kickRemainingSec: number;
  locked: boolean;
  /** Уже был в комнате — может вернуться и в запертую. */
  member: boolean;
  /** Этот участник — текущий хост (возвращается, например, после перезагрузки). */
  isHost: boolean;
  /** Кто сейчас в комнате по данным LiveKit. */
  participants: PresentParticipant[];
  maxParticipants: number;
};

/**
 * Пускать ли в комнату. null — пускать. Порядок важен: место и бан проверяются
 * после пароля (это делает маршрут), чтобы по ответам нельзя было узнать, кто
 * забанен, не зная пароля. Свой же identity в комнате (обрыв, «призрак»,
 * вторая вкладка) не мешает: LiveKit сам выбьет прежнее подключение.
 */
export function decideAdmission(input: AdmissionInput): ApiError | null {
  if (input.seat === "foreign") return apiError("SEAT_TAKEN");
  if (!input.owner) {
    if (input.banned) return apiError("BANNED");
    if (input.kickRemainingSec > 0) return retryError("KICKED", input.kickRemainingSec);
    if (input.locked && !input.member && !input.isHost) return apiError("ROOM_LOCKED");
  }

  const others = input.participants.filter((p) => p.identity !== input.identity);
  const takenKeys = new Set(others.map((p) => nicknameKey(p.name || p.identity)));
  const isTaken = (candidate: string) => takenKeys.has(nicknameKey(candidate));

  if (others.length >= input.maxParticipants) return roomFull(input.maxParticipants);
  if (isTaken(input.name)) return nameTaken(input.name, suggestNickname(input.name, isTaken));
  return null;
}

/**
 * Занимает ли входящий место хоста. Владелец (верный hostKey) получает корону,
 * если место свободно: хоста нет вовсе или его сейчас нет в комнате. Если права
 * у присутствующего участника (владелец сам их передал или их заняли, пока его не
 * было) — не отбираем молча: вернуть их можно действием reclaim.
 */
export function takesHostOnJoin(input: {
  owner: boolean;
  identity: string;
  hostIdentity: string | null;
  hostPresent: boolean;
}): boolean {
  if (!input.owner || input.hostIdentity === input.identity) return false;
  return input.hostIdentity === null || !input.hostPresent;
}
