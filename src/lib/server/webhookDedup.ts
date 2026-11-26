// Дедупликация вебхуков LiveKit по id события. LiveKit может прислать событие
// повторно, а на локальном стенде одно событие получают все дев-серверы сразу.
import { getRedisRaw } from "@/lib/redis";

// Повтор приходит в пределах секунд-минут; час — с большим запасом.
const DEDUP_TTL_SECONDS = 60 * 60;

/**
 * true — событие наше, обрабатываем; false — его уже взял другой обработчик.
 * Redis недоступен — обрабатываем (лучше дважды, чем ни разу: обработка
 * идемпотентна, а пропуск оставил бы, например, забаненного в комнате).
 */
export async function claimWebhookEvent(eventId: string): Promise<boolean> {
  if (!eventId) return true;
  try {
    const res = await getRedisRaw().set(`wh:${eventId}`, "1", {
      nx: true,
      ex: DEDUP_TTL_SECONDS,
    });
    return res !== null;
  } catch (err) {
    console.error("webhook dedup failed", err);
    return true;
  }
}
