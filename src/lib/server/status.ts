// Статус участника для других: «в игре», «отошёл», «слушаю» и «во что играю».
// Лежит в атрибутах участника LiveKit (STATUS_ATTRIBUTES в @/lib/api/contract),
// пишет его только сервер по POST /api/status — как «звук выкл» (./voice.ts).
import { STATUS_ATTRIBUTES, cleanStatusText, isManualStatus, type PublicStatus } from "@/lib/api/contract";
import { getRoomService, isNotFoundError } from "@/lib/livekit";

/** Тело POST /api/status → статус. kind — известный или null; text чистим; кривое — null. */
export function parseStatus(body: Record<string, unknown>): PublicStatus | null {
  const { kind, text } = body;
  if (kind !== null && !isManualStatus(kind)) return null;
  if (text !== undefined && typeof text !== "string") return null;
  // Текст держим только у «В игре»: у «Отошёл» он ничего бы не значил.
  return { kind, text: kind === "game" && text ? cleanStatusText(text) : "" };
}

/** Атрибуты для updateParticipant: оба ключа сразу, "" — снять ключ. */
export function statusAttributes(state: PublicStatus): Record<string, string> {
  return { [STATUS_ATTRIBUTES.kind]: state.kind ?? "", [STATUS_ATTRIBUTES.text]: state.text };
}

/** Пишет статус в атрибуты участника. Ушедшего LiveKit не найдёт — false. */
export async function applyStatus(code: string, identity: string, state: PublicStatus): Promise<boolean> {
  try {
    await getRoomService().updateParticipant(code, identity, { attributes: statusAttributes(state) });
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}
