// Серверная инструментация Next 16. register() вызывается один раз при старте
// инстанса сервера: грузим нужный конфиг Sentry по рантайму. onRequestError —
// хук Next (см. node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md),
// через него Sentry ловит ошибки серверных Route Handlers / RSC.
//
// Без DSN Sentry не нужен вовсе: ни конфиг, ни сам SDK не грузим (SDK — лениво,
// через import()), и сервер без ключа не держит его в памяти.
import type { Instrumentation } from "next";

const sentryEnabled = () => Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

export async function register() {
  if (!sentryEnabled()) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!sentryEnabled()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
