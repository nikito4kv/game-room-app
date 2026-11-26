// Голос участника для других: «звук выкл» и рация. Лежат в атрибутах участника
// LiveKit (ключи — VOICE_ATTRIBUTES в @/lib/api/contract), пишет их только сервер
// по POST /api/voice: свои атрибуты клиент менять не может.
import { VOICE_ATTRIBUTES, type PublicVoiceState } from "@/lib/api/contract";
import { getRoomService, isNotFoundError } from "@/lib/livekit";

const VOICE_KEYS = Object.keys(VOICE_ATTRIBUTES) as (keyof PublicVoiceState)[];

/** Тело POST /api/voice → состояние; оба флага строго boolean, иначе null. */
export function parseVoiceState(body: Record<string, unknown>): PublicVoiceState | null {
  const { deafened, ptt } = body;
  return typeof deafened === "boolean" && typeof ptt === "boolean" ? { deafened, ptt } : null;
}

/**
 * Атрибуты для updateParticipant. Пишем все ключи сразу: "1" — да, "" — снять
 * (пустое значение LiveKit понимает как удаление ключа). Чужих атрибутов не
 * трогаем: LiveKit меняет только перечисленные ключи.
 */
export function voiceAttributes(state: PublicVoiceState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of VOICE_KEYS) out[VOICE_ATTRIBUTES[key]] = state[key] ? "1" : "";
  return out;
}

/**
 * Пишет состояние голоса в атрибуты участника; metadata и права не трогает.
 * Заодно это проверка «сейчас в комнате»: ушедшего LiveKit не найдёт — false.
 *
 * Пишем всегда, не сверяясь с тем, что уже лежит: Server SDK переводит ключи
 * ответов LiveKit в camelCase (voice.deafened → voiceDeafened), и честно прочитать
 * атрибуты на сервере нельзя. Сверку «уже так» делает клиент по своим атрибутам —
 * их LiveKit присылает ему без искажений (см. @/lib/room/voicePresence).
 */
export async function applyVoiceState(
  code: string,
  identity: string,
  state: PublicVoiceState,
): Promise<boolean> {
  try {
    await getRoomService().updateParticipant(code, identity, { attributes: voiceAttributes(state) });
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}
