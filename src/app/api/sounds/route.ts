import { NextResponse } from "next/server";
import {
  isCustomSoundId,
  type SoundRemoveResponse,
  type SoundsListResponse,
  type SoundUploadResponse,
} from "@/lib/api/contract";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { clientIp, consumeLimit, soundReadLimit, soundUploadLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { addRoomSound, listRoomSounds, parseSoundUpload, removeRoomSound } from "@/lib/server/roomSounds";
import { broadcastSoundsChanged } from "@/lib/server/sounds";
import { getParticipantOrNull } from "@/lib/server/roomSync";
import { loadRoomMeta } from "@/lib/roomSecret";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce } from "@/lib/platform/signals";

// Свои звуки комнаты (контракт — раздел «Звуки комнаты» в src/lib/api/contract.ts).
//  • GET /api/sounds?code=… (Authorization: Bearer <token>) — список для вошедшего.
//  • POST /api/sounds { code, token, name, data } — добавить; { code, token, remove } — убрать.
// Автора и «хост ли он» сервер берёт из подписи токена и состояния комнаты. После
// любого изменения всем в комнате уходит пакет SOUNDS_CHANGED_TOPIC: пусть запросят список.

export async function GET(request: Request) {
  const code = normalizeRoomCode(new URL(request.url).searchParams.get("code"));
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const limit = await consumeLimit(soundReadLimit(), clientIp(request));
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));
  try {
    const response: SoundsListResponse = { sounds: await listRoomSounds(code) };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("sounds: list failed", err);
    return errorResponse(failureFrom(err));
  }
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  if (!isFlagOn(await loadRuntimeConfig(), "soundboard_upload", code)) {
    return errorResponse(apiError("FEATURE_DISABLED", "Свои звуки временно выключены"));
  }

  try {
    // Убрать: свой звук или любой — хосту. Тот, кого нет в комнате, не распоряжается.
    if (typeof body.remove === "string") {
      if (!isCustomSoundId(body.remove)) return errorResponse(apiError("BAD_REQUEST"));
      if (!(await getParticipantOrNull(code, caller.identity))) return errorResponse(apiError("NOT_IN_ROOM"));
      const meta = await loadRoomMeta(code);
      const done = await removeRoomSound(code, body.remove, {
        identity: caller.identity,
        isHost: meta?.hostIdentity === caller.identity,
      });
      if (done === "none") return errorResponse(apiError("SOUND_NOT_FOUND"));
      if (done === "denied") return errorResponse(apiError("NOT_HOST", "Убрать чужой звук может только хост"));
      await broadcastSoundsChanged(code);
      const response: SoundRemoveResponse = { ok: true };
      return NextResponse.json(response);
    }

    const upload = parseSoundUpload(body);
    if (!upload) return errorResponse(apiError("SOUND_INVALID"));
    const limit = await consumeLimit(soundUploadLimit(), `${code}:${caller.identity}`);
    if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
    if (!(await getParticipantOrNull(code, caller.identity))) return errorResponse(apiError("NOT_IN_ROOM"));
    const sound = await addRoomSound(code, caller.identity, upload);
    if (sound === "limit") return errorResponse(apiError("SOUND_LIMIT"));
    await broadcastSoundsChanged(code);
    void emitFeatureOnce("sound_upload", code, caller.identity);
    const response: SoundUploadResponse = { ok: true, sound };
    return NextResponse.json(response);
  } catch (err) {
    console.error("sounds: write failed", err);
    return errorResponse(failureFrom(err));
  }
}
