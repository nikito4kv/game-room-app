// Клиентская аналитика поверх posthog-js. Тонкая обёртка: единая точка
// инициализации и отправки событий, чтобы имена и конфиг не расходились.
//
// Приватность (см. дизайн-спеку §7): autocapture и session recording выключены,
// шлём только свои события и нормализованные pageview.
//
// Вес: posthog-js — около 70 КБ gzip. Пакет грузится отдельным чанком и только
// если задан NEXT_PUBLIC_POSTHOG_KEY (он вшивается при сборке). Без ключа все
// функции — пустые, а чанк браузер не скачивает вовсе. События, отправленные до
// загрузки чанка, ждут в очереди и уходят сразу после init.
import { DEFAULT_POSTHOG_INGESTION_HOST } from "./constants";
import { normalizePath } from "@/lib/url";

type PostHog = typeof import("posthog-js").default;

/** Имена событий — одно место правды, чтобы не плодить опечатки. */
export const EVENTS = {
  roomCreated: "room_created",
  roomJoined: "room_joined",
  // Румик (R2, R5): рисовалка на главной и в лобби, открытка. Свойство place: "hero" | "lobby".
  rumikEditorOpened: "rumik_editor_opened",
  rumikPaintStarted: "rumik_paint_started",
  rumikFileSaved: "rumik_file_saved",
  rumikFileLoaded: "rumik_file_loaded",
  rumikPostcardDownloaded: "rumik_postcard_downloaded",
  rumikPostcardShared: "rumik_postcard_shared",
} as const;

let client: PostHog | null = null;
let loading: Promise<void> | null = null;
const pending: Array<(posthog: PostHog) => void> = [];

/** Поднять posthog-js. No-op, если нет ключа, мы не в браузере или уже подняли. */
export function initAnalytics(): void {
  if (loading || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_INGESTION_HOST,
        autocapture: false,
        disable_session_recording: true,
        // Pageview шлём вручную (initAnalytics + onRouterTransitionStart), чтобы не
        // словить двойной счёт и контролировать нормализацию URL.
        capture_pageview: false,
        persistence: "localStorage",
      });
      client = posthog;
      for (const send of pending.splice(0)) send(posthog);
    })
    .catch((err: unknown) => {
      pending.length = 0;
      console.error("analytics: posthog не загрузился", err);
    });
}

/** Выполнить сейчас или после загрузки; без ключа — ничего. */
function withPosthog(send: (posthog: PostHog) => void): void {
  if (client) send(client);
  else if (loading) pending.push(send);
}

/** Отправить произвольное событие. No-op, если аналитика выключена. */
export function track(event: string, props?: Record<string, unknown>): void {
  withPosthog((posthog) => posthog.capture(event, props));
}

/**
 * Отправить $pageview. PostHog ожидает в $current_url абсолютный URL, поэтому
 * приклеиваем origin к нормализованному пути (код комнаты уже вырезан).
 */
export function capturePageview(path: string): void {
  if (typeof window === "undefined") return;
  const url = window.location.origin + normalizePath(path);
  withPosthog((posthog) => posthog.capture("$pageview", { $current_url: url }));
}
