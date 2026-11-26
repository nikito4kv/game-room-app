// Клиентская инициализация (Next 15.3+): выполняется после загрузки документа и
// ДО гидрации React. Здесь поднимаем телеметрию и шлём первый $pageview.
// Навигации между маршрутами ловим через onRouterTransitionStart.
//
// И Sentry, и PostHog грузятся отдельными чанками и только если заданы их ключи
// (NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_POSTHOG_KEY). Без ключей этот файл почти
// пустой и ничего не скачивает. Каждая телеметрия — в своём try/catch (по доке
// Next): сбой одной не валит другую и не трогает приложение.
import { capturePageview, initAnalytics } from "@/lib/analytics/posthogClient";
import { loadSentry, withSentry } from "@/lib/observability/sentryClient";

// Sentry первым: он подхватит и сбой инициализации аналитики ниже.
try {
  void loadSentry();
} catch (err) {
  console.error("sentry init failed", err);
}

try {
  initAnalytics();
  // Первый просмотр (вход на сайт) — onRouterTransitionStart на него не сработает.
  capturePageview(window.location.pathname + window.location.search);
} catch (err) {
  console.error("analytics init failed", err);
}

export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
): void {
  // Sentry-навигация и аналитика независимы: сбой одной не мешает другой.
  withSentry((Sentry) => Sentry.captureRouterTransitionStart(url, navigationType));
  try {
    capturePageview(url);
  } catch {
    // молча — навигация важнее телеметрии
  }
}
