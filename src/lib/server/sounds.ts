// Соундборд на сервере: разбор запроса и рассылка. Контракт — раздел «Соундборд»
// в src/lib/api/contract.ts, маршрут — /api/sound. Звук ничего не хранит: это
// один data-пакет от сервера всем в комнате, играет его каждый браузер сам.
import { DataPacket_Kind } from "livekit-server-sdk";
import {
  ENTER_SOUND_ATTRIBUTE,
  SOUNDS_CHANGED_TOPIC,
  SOUND_TOPIC,
  isSoundId,
  type SoundId,
  type SoundPacket,
} from "@/lib/api/contract";
import { getRoomService } from "@/lib/livekit";

/** Звук из тела запроса (поле sound); неизвестный или не строка — null. */
export function parseSoundId(body: Record<string, unknown>, field = "sound"): SoundId | null {
  const x = body[field];
  return isSoundId(x) ? x : null;
}

/** Пакет для рассылки. Кто играет — только из проверенного токена. */
export function soundPacket(identity: string, sound: SoundId, now: number = Date.now()): SoundPacket {
  return { identity, sound, at: now };
}

/** Атрибуты токена со звуком входа; звука нет — undefined (атрибутов не добавляем). */
export function enterSoundAttributes(sound: SoundId | null): Record<string, string> | undefined {
  return sound ? { [ENTER_SOUND_ATTRIBUTE]: sound } : undefined;
}

const encoder = new TextEncoder();

/**
 * Разослать звук всем в комнате, включая автора (свой он сыграл по клику и эхо
 * пропускает). Reliable: потерянный звук — «нажал, а никто не услышал».
 */
export async function broadcastSound(code: string, packet: SoundPacket): Promise<void> {
  await getRoomService().sendData(code, encoder.encode(JSON.stringify(packet)), DataPacket_Kind.RELIABLE, {
    topic: SOUND_TOPIC,
  });
}

/** Список звуков комнаты изменился: пусть все запросят его заново. Потерянный пакет не страшен: список обновится при открытии панели. */
export async function broadcastSoundsChanged(code: string): Promise<void> {
  await getRoomService()
    .sendData(code, encoder.encode(JSON.stringify({ at: Date.now() })), DataPacket_Kind.RELIABLE, {
      topic: SOUNDS_CHANGED_TOPIC,
    })
    .catch(() => undefined);
}
