import { isAvatarId, type ApiError } from "@/lib/api/contract";
import { avatarReadLimit, clientNet, consumeLimit } from "@/lib/ratelimit";
import { loadAvatar } from "@/lib/server/avatar";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { loadRuntimeConfig } from "@/lib/platform/runtimeConfig";

// GET /api/avatar/<id> — картинка рисунка Румика (image/png). id — хэш
// содержимого: по одному адресу всегда одна и та же картинка, поэтому кеш
// браузера держит её год. Кеш только личный (private): общие кеши по дороге
// картинку не хранят, и скрытый администрацией рисунок не всплывёт из них.
// Узнать id можно из атрибутов участника, то есть сидя в той же комнате;
// перебор упирается в лимит по адресу. Скрытый администрацией и истёкший
// рисунок — 404.

/** Отказ не кешируем: рисунок с этим id может появиться позже. */
function refusal(error: ApiError): Response {
  const res = errorResponse(error);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAvatarId(id)) return refusal(apiError("AVATAR_NOT_FOUND"));
  const limit = await consumeLimit(avatarReadLimit(), clientNet(request));
  if (limit.limited) return refusal(retryError("RATE_LIMITED", limit.retryAfterSec));
  try {
    // Флаг по комнате здесь не посчитать (в адресе нет комнаты), но «выключено
    // совсем» — повод не отдавать картинки никому.
    if ((await loadRuntimeConfig()).flags.rumik_share?.mode === "off") {
      return refusal(apiError("AVATAR_NOT_FOUND"));
    }
    const png = await loadAvatar(id);
    if (!png) return refusal(apiError("AVATAR_NOT_FOUND"));
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("avatar: read failed", err instanceof Error ? err.name : typeof err);
    return refusal(failureFrom(err));
  }
}
