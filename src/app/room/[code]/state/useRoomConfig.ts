"use client";

import type { PublicConfigResponse } from "@/lib/api/platform";
import { usePublicConfig } from "@/lib/client/usePublicConfig";
import { FALLBACK_PUBLIC_CONFIG } from "@/lib/client/publicConfig";
import { useRoomSession } from "./RoomSession";

/**
 * Настройки администрации для этой комнаты (флаги посчитаны для её кода, потолок
 * показа, объявления «в комнате»). Пока ответа нет — как будто ничего не
 * ограничено: комната работает как обычно.
 */
export function useRoomConfig(): PublicConfigResponse {
  const { code } = useRoomSession();
  return usePublicConfig(code) ?? FALLBACK_PUBLIC_CONFIG;
}
