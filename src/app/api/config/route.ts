import { NextResponse } from "next/server";
import { normalizeRoomCode } from "@/lib/livekit";
import { clientIp, configLimit, consumeLimit } from "@/lib/ratelimit";
import { errorResponse, retryError } from "@/lib/server/errors";
import { loadRuntimeConfig, toPublicConfig } from "@/lib/platform/runtimeConfig";

// GET /api/config?room=КОД — настройки продукта для браузера (PublicConfigResponse в
// src/lib/api/platform.ts): флаги, уже вычисленные для комнаты (или сайта), потолок
// качества показа, активные объявления, режим обслуживания, версия правил.
// Redis недоступен — значения по умолчанию (всё как до админки), а не ошибка.

export async function GET(request: Request) {
  const limit = await consumeLimit(configLimit(), clientIp(request));
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
  const room = normalizeRoomCode(new URL(request.url).searchParams.get("room"));
  const cfg = await loadRuntimeConfig();
  return NextResponse.json(toPublicConfig(cfg, room), { headers: { "Cache-Control": "no-store" } });
}
