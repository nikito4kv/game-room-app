import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/siteMeta";

// Манифест веб-приложения: сайт ставится на рабочий стол и в «Пуск» как
// приложение (своё окно без адресной строки, иконка). Флаг pwa (настройки
// продукта) — пока выключен, манифест без display и иконок: браузер не предлагает
// установку. Цвета — тёмная тема «Эфира» (viewport.themeColor в layout).

const BASE: MetadataRoute.Manifest = {
  name: SITE_NAME,
  short_name: SITE_NAME,
  description: SITE_DESCRIPTION,
  lang: "ru",
  start_url: "/",
};

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // Флаг меняется без пересборки — манифест считаем на каждый запрос.
  await connection();
  if (!isFlagOn(await loadRuntimeConfig(), "pwa")) return BASE;
  return {
    ...BASE,
    id: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0e11",
    theme_color: "#0d0e11",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
