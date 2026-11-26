// Инициализация Sentry для Node-рантайма. Подключается из src/instrumentation.ts
// (register), когда NEXT_RUNTIME === "nodejs". Опции — общие, из одной точки
// правды.
//
// Без DSN SDK не поднимаем вовсе: init даже с enabled: false заводит клиента,
// OpenTelemetry и перехват http — лишняя работа на каждом запросе к сайту.
import * as Sentry from "@sentry/nextjs";
import { sentryCommonOptions } from "@/lib/observability/sentryOptions";

if (sentryCommonOptions.enabled) Sentry.init(sentryCommonOptions);
