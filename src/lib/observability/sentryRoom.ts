// Контекст комнаты для Sentry. Чтобы видеть, что ошибки прилетели из одной
// комнаты, ставим тег `room` = необратимый короткий хэш кода (не сам код —
// приватность на одной линии с PostHog, см. дизайн-спеку §5).
//
// Это клиентская часть (тег ставится в браузерном scope). Серверные/edge ошибки
// получают тот же тег централизованно в beforeSend (sentryOptions.scrubEvent) —
// он достаёт код из URL/Referer события и хэширует тем же hashRoomCode.
//
// SDK грузится лениво и только с DSN (sentryClient.ts): без DSN обе функции —
// пустые и не тянут пакет в бандл комнаты.
import { hashRoomCode } from "@/lib/hash";
import { withSentry } from "./sentryClient";

/** Пометить текущую сессию хэшем комнаты. Без DSN — ничего. */
export function setRoomContext(code: string): void {
  const room = hashRoomCode(code);
  withSentry((Sentry) => Sentry.setTag("room", room));
}

/** Снять тег комнаты при выходе, чтобы он не «протёк» на последующие ошибки вне комнаты. */
export function clearRoomContext(): void {
  withSentry((Sentry) => Sentry.setTag("room", undefined));
}
