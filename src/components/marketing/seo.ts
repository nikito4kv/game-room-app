import type { Metadata } from "next";
import { SITE_NAME, SITE_OPEN_GRAPH } from "@/lib/siteMeta";

/**
 * Метаданные продающей страницы: title, description, canonical, превью ссылок.
 *
 * Страница, которая задаёт свой openGraph, заменяет корневой целиком вместе с
 * картинкой из файла app/opengraph-image.tsx, поэтому картинку указываем сами:
 * те же маршруты /opengraph-image и /twitter-image, что строят карточку сайта.
 * `title` без суффикса «· Game Room» подставит шаблон из корневого layout.
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  /** true — title целиком, без шаблона «%s · Game Room» (главная). */
  absoluteTitle?: boolean;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      title: fullTitle,
      description,
      url: path,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${SITE_NAME}: голосовая комната для своей компании` }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: ["/twitter-image"],
    },
  };
}
