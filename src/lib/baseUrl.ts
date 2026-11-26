/**
 * Базовый URL приложения — единственная точка правды для абсолютных ссылок
 * (metadataBase, og:url, абсолютные адреса OG-картинок). Discord/Telegram при
 * развороте ссылки требуют именно абсолютные URL.
 *
 * NEXT_PUBLIC_APP_URL — домен сайта (на проде его задаёт deploy/compose.yaml из
 * APP_DOMAIN); не задан — http://localhost:3000 для локальной разработки.
 */
const LOCALHOST = "http://localhost:3000";

export function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || LOCALHOST;

  // Гарантируем схему: "game-room.app" → "https://game-room.app". Без этого
  // new URL(getBaseUrl()) в layout.tsx бросил бы TypeError на верхнем уровне
  // модуля и уронил бы рендер ВСЕХ страниц.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const trimmed = withScheme.replace(/\/+$/, "");

  try {
    // Финальная валидация: при мусорном значении не роняем сайт, а откатываемся
    // на localhost.
    new URL(trimmed);
    return trimmed;
  } catch {
    return LOCALHOST;
  }
}
