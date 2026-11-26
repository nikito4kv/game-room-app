import { avatarStorage } from "@/lib/platform/avatarStorage";
import { internalRoute, platformJson } from "@/lib/platform/internalAuth";
import { readRuntimeConfig } from "@/lib/platform/runtimeConfig";

// GET /api/internal/avatars — хранилище рисунков Румика (AvatarStorageResponse):
// сколько их и сколько места, скрытые администрацией, потрачено из суточного
// бюджета и потолки из настроек. Подсчёт — SCAN с потолком шагов и кэшем на
// минуту (src/lib/platform/avatarStorage.ts); настройки — свежие, чтобы админка
// сразу видела новый бюджет.

export const GET = internalRoute("avatars", async () => {
  const { cfg } = await readRuntimeConfig();
  return platformJson(await avatarStorage(cfg));
});
