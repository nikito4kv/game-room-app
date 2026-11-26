import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Заголовки безопасности поделены между Next и Caddy, ни один не задаётся дважды.
// Caddy (deploy/Caddyfile) ставит общие для всех имён сервера: HSTS, nosniff,
// X-Frame-Options, Referrer-Policy. Здесь — то, что зависит от самого сайта и
// должно ехать вместе с кодом (в том числе на `next start` и любой другой хостинг).

/** Origin адреса из env или null: пустая или битая строка не должна ронять сборку. */
function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Хосты PostHog для CSP. posthog-js шлёт события на <регион>.i.posthog.com, а
 * скрипты расширений и конфиг проекта берёт с <регион>-assets.i.posthog.com;
 * со своим прокси (свой api_host) всё идёт через него. Хост по умолчанию — тот же,
 * что DEFAULT_POSTHOG_INGESTION_HOST в src/lib/analytics/constants.ts.
 */
function posthogOrigins(host: string): string[] {
  const origin = originOf(host);
  if (!origin) return [];
  const m = /^https:\/\/(app|us|eu)(?:-assets)?(?:\.i)?\.posthog\.com$/i.exec(origin);
  if (!m) return [origin];
  const region = m[1].toLowerCase() === "eu" ? "eu" : "us";
  return [`https://${region}.i.posthog.com`, `https://${region}-assets.i.posthog.com`];
}

/**
 * Content-Security-Policy. Next вычисляет headers() при `next build` и пишет их в
 * манифест сборки, поэтому адреса берутся из env сборки (в Dockerfile они приходят
 * build-args вместе с остальными NEXT_PUBLIC_*).
 *
 * - script-src 'unsafe-inline': App Router вставляет в HTML инлайновые скрипты
 *   (данные RSC, загрузчик). Обойтись без них можно только через nonce, а nonce
 *   требует proxy.ts и делает все страницы динамическими (node_modules/next/dist/
 *   docs/01-app/02-guides/content-security-policy.md). 'wasm-unsafe-eval' нужен
 *   шумодаву RNNoise (WebAssembly). Модуль AudioWorklet (/audio/) грузится по
 *   script-src — это 'self'.
 * - connect-src: сигналинг LiveKit (wss:, и https: — к нему же /rtc/validate при
 *   сбое подключения), Sentry и PostHog — только если заданы. Облачный LiveKit
 *   может увести клиента на соседний регион — для него весь *.livekit.cloud.
 *   STUN/TURN под CSP не попадают.
 */
function contentSecurityPolicy(env: NodeJS.ProcessEnv): string {
  const connect = new Set(["'self'"]);
  const scripts = new Set(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]);

  const livekit = originOf(env.NEXT_PUBLIC_LIVEKIT_URL);
  if (livekit) {
    connect.add(livekit).add(livekit.replace(/^ws/, "http"));
    if (/\.livekit\.cloud$/.test(new URL(livekit).hostname)) {
      connect.add("wss://*.livekit.cloud").add("https://*.livekit.cloud");
    }
  }
  const sentry = originOf(env.NEXT_PUBLIC_SENTRY_DSN);
  if (sentry) connect.add(sentry);
  if (env.NEXT_PUBLIC_POSTHOG_KEY) {
    for (const origin of posthogOrigins(env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com")) {
      connect.add(origin);
      scripts.add(origin);
    }
  }

  return [
    "default-src 'self'",
    `script-src ${[...scripts].join(" ")}`,
    `connect-src ${[...connect].join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Микрофон и показ экрана — только сам сайт; камеры в интерфейсе нет; прочее мощное
// запрещено. Выбор колонок (speaker-selection), полноэкранный режим и автозвук
// остаются по умолчанию — ими пользуется комната.
const PERMISSIONS_POLICY = [
  "microphone=(self)",
  "display-capture=(self)",
  "camera=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "bluetooth=()",
  "midi=()",
].join(", ");

const nextConfig: NextConfig = {
  // Своя машина вместо Vercel: standalone собирает server.js с минимальным
  // набором зависимостей — его и запускает образ из Dockerfile (см. deploy/).
  output: "standalone",
  // Отдельная папка сборки на каждый дев-сервер: несколько `next dev` в одной
  // рабочей копии (параллельная разработка, e2e) иначе дерутся за .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Не сообщать наружу, на чём сделан сайт.
  poweredByHeader: false,
  // Значок Next в деве лежит поверх кнопки микрофона на узком экране и мешает
  // скриншотам и e2e; ошибки сборки Next всё равно покажет оверлеем.
  devIndicators: false,
  async headers() {
    // Только production: в dev горячей перезагрузке и отладке React нужен eval.
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy(process.env) },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
        ],
      },
    ];
  },
};

// Обёртка Sentry: загрузка source maps включается только при наличии
// SENTRY_AUTH_TOKEN (плагин сам читает его из env); без токена сборка проходит,
// загрузка тихо пропускается. telemetry/silent — чтобы плагин не шумел и не слал
// свою телеметрию.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  telemetry: false,
});
