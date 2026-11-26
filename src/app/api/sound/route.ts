import { NextResponse } from "next/server";
import type { SoundResponse } from "@/lib/api/contract";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { consumeLimit, soundLimit, soundRoomLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, formatWait, retryError } from "@/lib/server/errors";
import { broadcastSound, parseSoundId, soundPacket } from "@/lib/server/sounds";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { getParticipantOrNull } from "@/lib/server/roomSync";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce } from "@/lib/platform/signals";

// POST /api/sound — звук соундборда для всех в комнате. Контракт — SoundRequest
// в src/lib/api/contract.ts. Как реакции: кто играет, сервер берёт из подписи
// токена и рассылает data-пакет от своего имени (тема SOUND_TOPIC). Сам звук
// синтезирует каждый браузер, по сети идёт только имя. Истории нет.

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  const sound = parseSoundId(body);
  if (!sound) return errorResponse(apiError("BAD_REQUEST"));

  // Новая фича: по умолчанию выключена, включают в настройках продукта.
  if (!isFlagOn(await loadRuntimeConfig(), "soundboard", code)) {
    return errorResponse(apiError("FEATURE_DISABLED", "Звуки временно выключены"));
  }

  // Сначала свой счётчик, потом общий на комнату: флудер не съедает чужие звуки.
  const mine = await consumeLimit(soundLimit(), `${code}:${caller.identity}`);
  if (mine.limited) return errorResponse(retryError("RATE_LIMITED", mine.retryAfterSec));
  const room = await consumeLimit(soundRoomLimit(), code);
  if (room.limited) {
    const sec = Math.max(1, Math.ceil(room.retryAfterSec));
    return errorResponse({
      ...retryError("RATE_LIMITED", sec),
      message: `В комнате и так много звуков. Подождите ${formatWait(sec)}`,
    });
  }

  try {
    // Только тем, кто сейчас в комнате: выгнанный не посигналит старым токеном.
    if (!(await getParticipantOrNull(code, caller.identity))) {
      return errorResponse(apiError("NOT_IN_ROOM"));
    }
    await broadcastSound(code, soundPacket(caller.identity, sound));
    // Вид — для «звуков по видам» в админке; ника в событии нет.
    void emitFeatureOnce("soundboard", code, caller.identity, sound);
    const response: SoundResponse = { ok: true };
    return NextResponse.json(response);
  } catch (err) {
    console.error("sound: send failed", err);
    return errorResponse(failureFrom(err));
  }
}
