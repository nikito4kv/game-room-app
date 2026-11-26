// ВАЖНО: этот модуль импортируется только из серверных Route Handlers / вебхука.
// Токен Upstash не должен попадать в клиентские компоненты.
import { Redis } from "@upstash/redis";
import { requireEnv } from "./livekit";

/**
 * Ленивые клиенты Redis (REST-протокол Upstash; на своём сервере — прослойка
 * serverless-redis-http над обычным Redis).
 *
 * Зачем Redis, если у проекта «нет своей БД»: состояние комнаты (описание и
 * настройки, хэши пароля и ключа владельца, места, баны, мьюты, история чата)
 * нельзя держать в metadata LiveKit — её видят все участники, и она пропадает при
 * перезапуске LiveKit. Тот же Redis считает лимиты частоты (ratelimit.ts).
 *
 * Таймаут и повторы. По умолчанию @upstash/redis делает 5 повторов с паузами до
 * 2,7 с и не ограничивает зависший запрос: при упавшей прослойке вход в комнату
 * висел ~9 с. Теперь на команду (вместе с повтором) — не больше 1,5 с, повтор один:
 * быстрый отказ «сервер недоступен» лучше долгого молчания. signal — функция,
 * чтобы каждый запрос получал свой таймер (общий AbortSignal истёк бы навсегда).
 */
const REDIS_TIMEOUT_MS = 1500;
const clientOptions = {
  retry: { retries: 1, backoff: () => 200 },
  signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
};

let _redis: Redis | null = null;

/** Клиент с авто-(де)сериализацией JSON — для лимитов частоты. */
export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: requireEnv("UPSTASH_REDIS_REST_URL"),
      token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
      ...clientOptions,
    });
  }
  return _redis;
}

let _redisRaw: Redis | null = null;

/**
 * Клиент БЕЗ автоматической (де)сериализации JSON — для состояния комнаты
 * (roomSecret.ts) и аналитики. Там значения — ники, identity, JSON-строки: с
 * авто-разбором ник "42" вернулся бы числом, а строка с `{` могла бы упасть на
 * JSON.parse. Здесь всё ходит непрозрачными строками; HGETALL отдаёт плоский
 * массив [поле, значение, …].
 */
export function getRedisRaw(): Redis {
  if (!_redisRaw) {
    _redisRaw = new Redis({
      url: requireEnv("UPSTASH_REDIS_REST_URL"),
      token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
      automaticDeserialization: false,
      ...clientOptions,
    });
  }
  return _redisRaw;
}
