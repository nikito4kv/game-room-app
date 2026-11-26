import { NextResponse } from "next/server";
import type { ParticipantInfo, Room } from "livekit-server-sdk";
import {
  LIVEKIT_QUICK_TIMEOUT_SEC,
  getRoomService,
  isNotFoundError,
  normalizeRoomCode,
} from "@/lib/livekit";
import { loadRoomMeta } from "@/lib/roomSecret";
import { clientIp, consumeLimit, previewLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { buildPreview } from "@/lib/server/preview";
import { loadRoomMetaOrAdopt, roomCapacity } from "@/lib/server/roomSync";
import { loadRuntimeConfig } from "@/lib/platform/runtimeConfig";

// GET /api/rooms/КОД — превью комнаты для лобби: название, замок, пароль,
// сколько человек и кто (без имён, если у комнаты пароль). Контракт —
// PreviewResponse в src/lib/api/contract.ts.
//
// Описание — из Redis (без него комнаты нет). Состав — из LiveKit с коротким
// таймаутом: превью не должно висеть или падать из-за LiveKit, оно лишь
// подсказывает, куда человек сейчас войдёт.

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeRoomCode((await params).code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));

  const limit = await consumeLimit(previewLimit(), `${clientIp(request)}:${code}`);
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  try {
    const quick = getRoomService(LIVEKIT_QUICK_TIMEOUT_SEC);
    const [stored, liveRoom, participants, cfg] = await Promise.all([
      loadRoomMeta(code),
      // Не ответил — null: превью соберётся без LiveKit.
      quick.listRooms([code]).then(
        (rooms): Room | null => rooms[0] ?? null,
        () => null,
      ),
      // Комнаты нет в LiveKit (потерял при перезапуске) — внутри точно никого;
      // любой другой сбой — состав неизвестен.
      quick.listParticipants(code).catch((err: unknown): ParticipantInfo[] | null =>
        isNotFoundError(err) ? [] : null,
      ),
      loadRuntimeConfig(),
    ]);
    const meta = stored ?? (await loadRoomMetaOrAdopt(code, liveRoom));
    if (!meta) return errorResponse(apiError("ROOM_NOT_FOUND"));
    return NextResponse.json(buildPreview({ code, meta, liveRoom, participants, capacity: roomCapacity(meta, cfg) }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("preview failed", err);
    return errorResponse(failureFrom(err));
  }
}
