import { isCustomSoundId, type ApiError } from "@/lib/api/contract";
import { normalizeRoomCode } from "@/lib/livekit";
import { clientIp, consumeLimit, soundReadLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { getRoomSoundFile } from "@/lib/server/roomSounds";

// GET /api/sounds/<id>?code=КОД — файл своего звука комнаты. id — хэш содержимого,
// поэтому по одному адресу всегда один и тот же файл: кеш браузера держит его
// год, но только личный (private) — общие кеши по дороге звук не хранят, и убранный
// звук не всплывёт из них. Нет звука или комнаты — 404.

function refusal(error: ApiError): Response {
  const res = errorResponse(error);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const code = normalizeRoomCode(new URL(request.url).searchParams.get("code"));
  if (!code || !isCustomSoundId(id)) return refusal(apiError("SOUND_NOT_FOUND"));
  const limit = await consumeLimit(soundReadLimit(), clientIp(request));
  if (limit.limited) return refusal(retryError("RATE_LIMITED", limit.retryAfterSec));
  try {
    const file = await getRoomSoundFile(code, id);
    if (!file) return refusal(apiError("SOUND_NOT_FOUND"));
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.data.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("sounds: read failed", err);
    return refusal(failureFrom(err));
  }
}
