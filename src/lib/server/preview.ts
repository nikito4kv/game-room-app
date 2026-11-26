// Превью комнаты для лобби (GET /api/rooms/КОД) — чистая сборка ответа из того,
// что удалось узнать: описание из Redis (оно есть всегда) и состав из LiveKit
// (может не прийти — тогда ответ без имён, а не ошибка).
import { MAX_PARTICIPANTS, type PreviewResponse } from "@/lib/api/contract";
import type { StoredRoomMeta } from "@/lib/roomSecret";

type LivePerson = { identity: string; name: string; joinedAt?: bigint };

export function buildPreview(input: {
  code: string;
  meta: StoredRoomMeta;
  /** Комната в LiveKit; null — её там нет или LiveKit не ответил. */
  liveRoom: { numParticipants: number; maxParticipants: number } | null;
  /** Состав из LiveKit; null — LiveKit не ответил вовремя. */
  participants: readonly LivePerson[] | null;
  /** Лимит ключа клуба или настроек продукта (roomCapacity); не задан — как раньше. */
  capacity?: number;
}): PreviewResponse {
  const { code, meta, liveRoom, participants, capacity } = input;
  const preview: PreviewResponse = {
    code,
    title: meta.title,
    hasPassword: meta.hasPassword,
    locked: meta.locked,
    isPublic: meta.isPublic,
    participantCount: participants?.length ?? liveRoom?.numParticipants ?? 0,
    maxParticipants:
      capacity === undefined
        ? liveRoom?.maxParticipants || MAX_PARTICIPANTS
        : Math.min(liveRoom?.maxParticipants || capacity, capacity),
  };
  if (meta.badge) preview.badge = meta.badge;
  // С паролем имена до входа не показываем — только сколько человек внутри.
  if (participants && !meta.hasPassword) {
    preview.participants = [...participants]
      .sort((a, b) => {
        const host = Number(b.identity === meta.hostIdentity) - Number(a.identity === meta.hostIdentity);
        return host || Number(a.joinedAt ?? 0n) - Number(b.joinedAt ?? 0n);
      })
      .map((p) => ({ name: p.name || "Участник", isHost: p.identity === meta.hostIdentity }));
  }
  return preview;
}
