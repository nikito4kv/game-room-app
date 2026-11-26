// Инициализация Sentry для edge-рантайма (middleware и edge Route Handlers).
// Подключается из src/instrumentation.ts (register), когда NEXT_RUNTIME === "edge".
// Опции — общие, из одной точки правды. Без DSN SDK не поднимаем (как и на Node).
import * as Sentry from "@sentry/nextjs";
import { sentryCommonOptions } from "@/lib/observability/sentryOptions";

if (sentryCommonOptions.enabled) Sentry.init(sentryCommonOptions);
