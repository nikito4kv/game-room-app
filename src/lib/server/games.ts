// Игры в комнате на сервере: разбор запроса, честный случай и рассылка.
// Контракт — раздел «Игры в комнате» в src/lib/api/contract.ts, маршрут —
// /api/game. Сервер ничего не хранит: результат — один data-пакет всем.
import { randomBytes, randomInt } from "node:crypto";
import { DataPacket_Kind } from "livekit-server-sdk";
import { GAME_TOPIC, isGameId, type GameCommand, type GamePacket } from "@/lib/api/contract";
import { getRoomService } from "@/lib/livekit";

/** Команда из тела запроса; неизвестная или кривая — null (BAD_REQUEST). */
export function parseGameCommand(body: Record<string, unknown>): GameCommand | null {
  switch (body.action) {
    case "dice":
    case "pick":
    case "ready":
      return { action: body.action };
    case "ready_answer":
      return isGameId(body.id) && typeof body.ready === "boolean"
        ? { action: "ready_answer", id: body.id, ready: body.ready }
        : null;
    default:
      return null;
  }
}

/** Случай: целое из [0, n). В тестах — подставной. */
export type Chance = (n: number) => number;
export const fairChance: Chance = (n) => randomInt(n);

/** Кубик: 1–6. */
export function rollDie(chance: Chance = fairChance): number {
  return chance(6) + 1;
}

/** Случайный из кандидатов; пусто — null. */
export function pickOne(candidates: readonly string[], chance: Chance = fairChance): string | null {
  return candidates.length ? candidates[chance(candidates.length)] : null;
}

/** id опроса «Все готовы?»: 12 случайных байт в base64url (16 символов). */
export function newGameId(): string {
  return randomBytes(12).toString("base64url");
}

const encoder = new TextEncoder();

/** Разослать результат всем в комнате, включая автора. Reliable: итог не должен теряться. */
export async function broadcastGame(code: string, packet: GamePacket): Promise<void> {
  await getRoomService().sendData(code, encoder.encode(JSON.stringify(packet)), DataPacket_Kind.RELIABLE, {
    topic: GAME_TOPIC,
  });
}
