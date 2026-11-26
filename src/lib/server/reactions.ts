// Реакции в комнате (👍 🔥 😂 GG) на сервере: разбор запроса и рассылка.
// Контракт — раздел «Реакции» в src/lib/api/contract.ts, маршрут — /api/reaction.
// Реакция ничего не хранит: это один data-пакет от сервера всем в комнате.
import { DataPacket_Kind } from "livekit-server-sdk";
import {
  REACTION_TOPIC,
  isReactionKind,
  type ReactionKind,
  type ReactionPacket,
} from "@/lib/api/contract";
import { getRoomService } from "@/lib/livekit";

/** Реакция из тела запроса; неизвестная или не строка — null (BAD_REQUEST). */
export function parseReactionKind(body: Record<string, unknown>): ReactionKind | null {
  return isReactionKind(body.kind) ? body.kind : null;
}

/** Пакет для рассылки. Кто реагирует — только из проверенного токена. */
export function reactionPacket(identity: string, kind: ReactionKind, now: number = Date.now()): ReactionPacket {
  return { identity, kind, at: now };
}

const encoder = new TextEncoder();

/**
 * Разослать реакцию всем в комнате, включая автора (его клиент узнаёт своё эхо
 * по identity и второй раз не показывает). Reliable: пакет крошечный, а
 * потерянная реакция выглядела бы как «нажал — никто не увидел».
 */
export async function broadcastReaction(code: string, packet: ReactionPacket): Promise<void> {
  await getRoomService().sendData(code, encoder.encode(JSON.stringify(packet)), DataPacket_Kind.RELIABLE, {
    topic: REACTION_TOPIC,
  });
}
