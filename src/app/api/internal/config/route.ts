import type { RuntimeConfig } from "@/lib/api/platform";
import { getRoomService } from "@/lib/livekit";
import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
  readInternalJson,
} from "@/lib/platform/internalAuth";
import {
  isFlagOn,
  readRuntimeConfig,
  validateConfigInput,
  writeRuntimeConfig,
} from "@/lib/platform/runtimeConfig";
import { syncParticipants } from "@/lib/server/roomSync";

// /api/internal/config — настройки продукта (А3).
//   GET → RuntimeConfig (свежий, без кэша)
//   PUT { config, expectedRev } (ConfigPutRequest) → новый RuntimeConfig;
//       409 { error: "conflict", current } — конфиг успели поменять (другая вкладка).
// Сайт подхватывает новый конфиг за ≈10 с (кэш в памяти).

export const GET = internalRoute("config", async () => platformJson((await readRuntimeConfig()).cfg));

export const PUT = internalRoute("config_put", async (request) => {
  const body = await readInternalJson(request);
  if (!body) return platformError(400, "bad_request");
  const expectedRev = body.expectedRev;
  if (typeof expectedRev !== "number" || !Number.isInteger(expectedRev) || expectedRev < 0) {
    return platformError(400, "bad_rev", "Нужен expectedRev — текущая ревизия конфига");
  }
  const checked = validateConfigInput(body.config);
  if (!checked.ok) return platformError(400, "bad_config", checked.message);
  const before = (await readRuntimeConfig()).cfg;
  const res = await writeRuntimeConfig(checked.value, expectedRev);
  if (!res.ok) {
    return platformJson(
      { error: "conflict", message: "Настройки уже поменяли — обновите страницу", current: res.current },
      409,
    );
  }
  void emitAdminEvent("config", { reason: `rev ${res.config.rev}` });
  // Аварийное выключение показа экрана: отзываем право у тех, кто уже в комнатах,
  // а не ждём их следующего входа. LiveKit сам снимет идущие показы.
  if (screenFlagChanged(before, res.config)) {
    await resyncAllRooms().catch((err: unknown) => console.error("config: resync failed", err));
  }
  return platformJson(res.config);
});

/** Поменялось ли, где разрешён показ экрана (по правилу флага). */
function screenFlagChanged(a: RuntimeConfig, b: RuntimeConfig): boolean {
  return JSON.stringify(a.flags.screen_share ?? null) !== JSON.stringify(b.flags.screen_share ?? null) ||
    isFlagOn(a, "screen_share") !== isFlagOn(b, "screen_share");
}

async function resyncAllRooms(): Promise<void> {
  const rooms = await getRoomService().listRooms();
  await Promise.all(rooms.map((r) => syncParticipants(r.name)));
}
