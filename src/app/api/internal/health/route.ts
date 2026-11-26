import type { AppHealthResponse } from "@/lib/api/platform";
import { LIVEKIT_QUICK_TIMEOUT_SEC, getRoomService } from "@/lib/livekit";
import { getRedisRaw } from "@/lib/redis";
import { internalRoute, platformJson } from "@/lib/platform/internalAuth";
import { readRuntimeConfig } from "@/lib/platform/runtimeConfig";

// GET /api/internal/health — сайт о себе (AppHealthResponse): версия сборки (из
// build-arg GIT_COMMIT / BUILT_AT в Dockerfile), отклик Redis и LiveKit, ревизия
// настроек продукта. Отвечает 200 и при сбоях — ok: false с подробностями.

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number | null; value: T | null }> {
  const start = performance.now();
  try {
    const value = await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - start), value };
  } catch {
    return { ok: false, latencyMs: null, value: null };
  }
}

export const GET = internalRoute("health", async () => {
  const [redis, livekit, cfg] = await Promise.all([
    timed(() => getRedisRaw().ping()),
    timed(() => getRoomService(LIVEKIT_QUICK_TIMEOUT_SEC).listRooms(["__health__"])),
    timed(() => readRuntimeConfig()),
  ]);
  const body: AppHealthResponse = {
    ok: redis.ok && livekit.ok,
    version: { commit: process.env.GIT_COMMIT || null, builtAt: process.env.BUILT_AT || null },
    redis: { ok: redis.ok, latencyMs: redis.latencyMs },
    livekit: { ok: livekit.ok, latencyMs: livekit.latencyMs },
    config: { rev: cfg.value?.cfg.rev ?? 0, updatedAt: cfg.value?.cfg.updatedAt ?? null },
  };
  return platformJson(body);
});
