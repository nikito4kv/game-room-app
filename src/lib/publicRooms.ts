// Витрина публичных комнат (/rooms и GET /api/rooms): сортировка и сборка
// карточек. Чистый модуль без серверных импортов — легко проверить тестами.
// Форма карточки — PublicRoomSummary из общего контракта.
import type { PublicRoomSummary } from "@/lib/api/contract";
import type { RoomBadge } from "@/lib/api/platform";

/**
 * Кандидат в витрину: живая комната LiveKit + её разобранное описание.
 * Минимальная форма (без типов серверного SDK).
 */
export type PublicRoomCandidate = {
  room: { name: string; numParticipants: number; maxParticipants: number };
  meta: { title: string; hostName: string; createdAt: number; locked: boolean; badge?: RoomBadge };
};

/** Сортировка витрины: больше участников → новее. Вход не мутирует. */
export function sortPublicRooms(candidates: PublicRoomCandidate[]): PublicRoomCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.room.numParticipants - a.room.numParticipants ||
      b.meta.createdAt - a.meta.createdAt,
  );
}

/**
 * Собирает карточки из уже отобранной верхушки и пачки auth из Redis (её читаем
 * только по этим кодам). Значение auth по коду:
 *  • null      — состояния в Redis нет: войти нельзя, не показываем;
 *  • undefined — чтение упало: неизвестно, консервативно hasPassword: true;
 *  • объект    — hasPassword по passwordHash.
 */
export function toPublicRoomSummaries(
  candidates: PublicRoomCandidate[],
  authByCode: Map<string, { passwordHash: string | null } | null>,
): PublicRoomSummary[] {
  return candidates.flatMap(({ room, meta }) => {
    const auth = authByCode.get(room.name);
    if (auth === null) return [];
    return [
      {
        code: room.name,
        title: meta.title,
        hostName: meta.hostName,
        numParticipants: room.numParticipants,
        maxParticipants: room.maxParticipants,
        createdAt: meta.createdAt,
        locked: meta.locked,
        hasPassword: auth ? auth.passwordHash != null : true,
        ...(meta.badge ? { badge: meta.badge } : {}),
      },
    ];
  });
}
