import { NextResponse } from "next/server";
import type { GamePacket, GameResponse } from "@/lib/api/contract";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { consumeLimit, gameLimit, readyCheckLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { broadcastGame, newGameId, parseGameCommand, pickOne, rollDie } from "@/lib/server/games";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { getParticipantOrNull, listParticipantsOrEmpty } from "@/lib/server/roomSync";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce } from "@/lib/platform/signals";

// POST /api/game — кубик, «Кто платит?» и «Все готовы?». Контракт — GameRequest
// в src/lib/api/contract.ts. Как реакции: кто играет, сервер берёт из подписи
// токена; случай считает сам (crypto) и рассылает итог data-пакетом от своего
// имени (тема GAME_TOPIC). Ничего не хранит: ответы на опрос собирают клиенты.

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  const command = parseGameCommand(body);
  if (!command) return errorResponse(apiError("BAD_REQUEST"));

  if (!isFlagOn(await loadRuntimeConfig(), "games", code)) {
    return errorResponse(apiError("FEATURE_DISABLED", "Игры временно выключены"));
  }

  const mine = await consumeLimit(gameLimit(), `${code}:${caller.identity}`);
  if (mine.limited) return errorResponse(retryError("RATE_LIMITED", mine.retryAfterSec));
  if (command.action === "ready") {
    const room = await consumeLimit(readyCheckLimit(), code);
    if (room.limited) return errorResponse(retryError("RATE_LIMITED", room.retryAfterSec));
  }

  try {
    // Только тем, кто сейчас в комнате: выгнанный не бросит кубик старым токеном.
    if (!(await getParticipantOrNull(code, caller.identity))) {
      return errorResponse(apiError("NOT_IN_ROOM"));
    }
    const at = Date.now();
    let packet: GamePacket;
    switch (command.action) {
      case "dice":
        packet = { kind: "dice", identity: caller.identity, value: rollDie(), at };
        break;
      case "pick": {
        // Из тех, кто сейчас в комнате (люди — identity «u_…»).
        const people = (await listParticipantsOrEmpty(code)).map((p) => p.identity).filter((id) => id.startsWith("u_"));
        const chosen = pickOne(people);
        if (!chosen) return errorResponse(apiError("NOT_IN_ROOM"));
        packet = { kind: "pick", identity: caller.identity, chosen, at };
        break;
      }
      case "ready":
        packet = { kind: "ready", identity: caller.identity, id: newGameId(), at };
        break;
      case "ready_answer":
        packet = { kind: "ready_answer", identity: caller.identity, id: command.id, ready: command.ready, at };
        break;
    }
    await broadcastGame(code, packet);
    if (command.action !== "ready_answer") void emitFeatureOnce("game", code, caller.identity, command.action);
    const response: GameResponse = { ok: true };
    return NextResponse.json(response);
  } catch (err) {
    console.error("game: send failed", err);
    return errorResponse(failureFrom(err));
  }
}
