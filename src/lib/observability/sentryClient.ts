// Sentry в браузере — только если задан DSN, и тогда отдельным чанком.
//
// Пакет @sentry/nextjs — десятки килобайт gzip в первой загрузке каждой
// страницы. На проде DSN может быть не задан, и тогда грузить SDK незачем:
// NEXT_PUBLIC_SENTRY_DSN вшивается при сборке, без него import() ниже
// недостижим и чанк SDK браузер не скачивает вовсе.
//
// Цена: SDK поднимается не до гидрации, а чуть позже (пока грузится чанк).
// Ошибки этого окна не теряем — копим и отправляем после init.
import { sentryCommonOptions } from "./sentryOptions";

type SentryModule = typeof import("@sentry/nextjs");

let loading: Promise<SentryModule | null> | null = null;

/**
 * Загрузить и поднять SDK — один раз на вкладку. null — DSN не задан, мы не в
 * браузере или чанк не загрузился (телеметрия не должна ломать сайт).
 */
export function loadSentry(): Promise<SentryModule | null> {
  if (loading) return loading;
  if (!sentryCommonOptions.enabled || typeof window === "undefined") return Promise.resolve(null);

  // Ошибки, случившиеся, пока грузится SDK.
  const early: unknown[] = [];
  const onError = (e: ErrorEvent) => early.push(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => early.push(e.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const stopCollecting = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };

  loading = import("@sentry/nextjs")
    .then((Sentry) => {
      stopCollecting();
      Sentry.init(sentryCommonOptions);
      for (const err of early.splice(0)) Sentry.captureException(err);
      return Sentry;
    })
    .catch((err: unknown) => {
      stopCollecting();
      console.error("sentry: не загрузился", err);
      return null;
    });
  return loading;
}

/**
 * Сделать что-то с SDK, когда (и если) он загрузится. Без DSN — ничего.
 * Колбэки выполняются в порядке вызова: setTag → снятие тега не перепутаются.
 */
export function withSentry(fn: (Sentry: SentryModule) => void): void {
  if (!sentryCommonOptions.enabled) return;
  void loadSentry().then((Sentry) => {
    if (!Sentry) return;
    try {
      fn(Sentry);
    } catch {
      // телеметрия не должна ронять интерфейс
    }
  });
}

/** Отправить ошибку, пойманную границей ошибок (error.tsx, global-error.tsx). */
export function reportError(error: unknown): void {
  withSentry((Sentry) => Sentry.captureException(error));
}
