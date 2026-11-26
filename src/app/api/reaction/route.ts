import { NextResponse } from "next/server";
import type { ReactionResponse } from "@/lib/api/contract";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { consumeLimit, reactionLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { broadcastReaction, parseReactionKind, reactionPacket } from "@/lib/server/reactions";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { getParticipantOrNull } from "@/lib/server/roomSync";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce } from "@/lib/platform/signals";

// POST /api/reaction — реакция над своим местом (👍 🔥 😂 GG). Контракт —
// ReactionRequest в src/lib/api/contract.ts. Как чат: кто реагирует, сервер
// берёт из подписи токена (не из тела) и рассылает data-пакет от своего имени
// (тема REACTION_TOPIC) всем, кто в комнате. Своих пакетов клиенты слать не
// могут (canPublishData: false). Истории нет.

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  const kind = parseReactionKind(body);
  if (!kind) return errorResponse(apiError("BAD_REQUEST"));

  // Аварийный выключатель (настройки продукта): по комнате.
  if (!isFlagOn(await loadRuntimeConfig(), "reactions", code)) {
    return errorResponse(apiError("FEATURE_DISABLED", "Реакции временно выключены"));
  }

  const limit = await consumeLimit(reactionLimit(), `${code}:${caller.identity}`);
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  try {
    // Только тем, кто сейчас в комнате: выгнанный не помашет старым токеном.
    if (!(await getParticipantOrNull(code, caller.identity))) {
      return errorResponse(apiError("NOT_IN_ROOM"));
    }
    await broadcastReaction(code, reactionPacket(caller.identity, kind));
    // Вид — для «реакций по видам» в админке; ника в событии нет (identity — устройство).
    void emitFeatureOnce("reaction", code, caller.identity, kind);
    const response: ReactionResponse = { ok: true };
    return NextResponse.json(response);
  } catch (err) {
    console.error("reaction: send failed", err);
    return errorResponse(failureFrom(err));
  }
}
