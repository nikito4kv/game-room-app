import { NextResponse } from "next/server";
import type { VoiceResponse } from "@/lib/api/contract";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { consumeLimit, voiceLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { applyVoiceState, parseVoiceState } from "@/lib/server/voice";
import { emitFeatureOnce } from "@/lib/platform/signals";

// POST /api/voice — своё «звук выкл» и рация, чтобы их видели другие. Контракт —
// VoiceRequest в src/lib/api/contract.ts. Кому писать, сервер берёт из подписи
// токена (не из тела), и только тому, кто сейчас в комнате — как у /api/chat.
// Пишем в атрибуты участника LiveKit: metadata с решениями хоста не трогаем.

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  const state = parseVoiceState(body);
  if (!state) return errorResponse(apiError("BAD_REQUEST"));

  const limit = await consumeLimit(voiceLimit(), `${code}:${caller.identity}`);
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  try {
    // Запись — она же проверка «сейчас в комнате»: ушедшего LiveKit не найдёт.
    if (!(await applyVoiceState(code, caller.identity, state))) {
      return errorResponse(apiError("NOT_IN_ROOM"));
    }
    // Использование рации и «звук выкл» — для графиков функций (не чаще раза в минуту).
    if (state.ptt) void emitFeatureOnce("ptt", code, caller.identity);
    if (state.deafened) void emitFeatureOnce("deafen", code, caller.identity);
    const response: VoiceResponse = { ok: true };
    return NextResponse.json(response);
  } catch (err) {
    console.error("voice: update failed", err);
    return errorResponse(failureFrom(err));
  }
}
