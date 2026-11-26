import { NextResponse } from "next/server";
import type { StatusResponse } from "@/lib/api/contract";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { consumeLimit, statusLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { applyStatus, parseStatus } from "@/lib/server/status";
import { detectChatFlag } from "@/lib/platform/chatFlags";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce, emitSignal } from "@/lib/platform/signals";

// POST /api/status — свой статус («в игре: CS2», «отошёл», «слушаю»), чтобы его
// видели другие. Контракт — StatusRequest в src/lib/api/contract.ts. Как
// /api/voice: кому писать, сервер берёт из подписи токена и пишет в атрибуты
// участника LiveKit; ушедшего LiveKit не найдёт — NOT_IN_ROOM.

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  const state = parseStatus(body);
  if (!state) return errorResponse(apiError("BAD_REQUEST"));

  // Снять статус можно всегда: выключенный флаг не должен оставлять старый значок.
  if (state.kind && !isFlagOn(await loadRuntimeConfig(), "statuses", code)) {
    return errorResponse(apiError("FEATURE_DISABLED", "Статусы временно выключены"));
  }

  const limit = await consumeLimit(statusLimit(), `${code}:${caller.identity}`);
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  try {
    if (!(await applyStatus(code, caller.identity, state))) return errorResponse(apiError("NOT_IN_ROOM"));
    // «Во что играю» видят все в комнате — те же слова-сигналы, что в чате.
    const flagged = state.text ? detectChatFlag(state.text) : null;
    if (flagged) {
      void emitSignal("chat_flag", "medium", {
        code,
        identity: caller.identity,
        detail: `статус · ${flagged.category}: ${flagged.excerpt}`,
      });
    }
    if (state.kind) void emitFeatureOnce("status", code, caller.identity, state.kind);
    const response: StatusResponse = { ok: true };
    return NextResponse.json(response);
  } catch (err) {
    console.error("status: update failed", err);
    return errorResponse(failureFrom(err));
  }
}
