import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PageBeacon } from "@/components/platform/PageBeacon";
import { getBaseUrl } from "@/lib/baseUrl";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OPEN_GRAPH } from "@/lib/siteMeta";
import { fontVariables } from "./fonts";

export const metadata: Metadata = {
  // Абсолютная база для og:url и путей OG-картинок: краулеры Discord и Telegram
  // разворачивают только абсолютные ссылки. Страницы переопределяют title и
  // openGraph сами (комната — через generateMetadata).
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: `${SITE_NAME} · голосовая комната для своих`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { ...SITE_OPEN_GRAPH, title: SITE_NAME, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = {
  // Цвет панели браузера на телефоне = фон приложения (--gr-canvas в tokens.css).
  themeColor: "#0d0e11",
  // Тёмная тема по умолчанию: тёмные полосы прокрутки и поля браузера сразу,
  // ещё до загрузки стилей.
  colorScheme: "dark",
};

// Корневой макет: только документ, шрифты и метаданные. Шапка сайта — в
// (site)/layout.tsx: у комнаты своя шапка, и общая туда не попадает.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        {/* Маяк посещений (А4): путь и источник в /api/ev, без имени и cookie. */}
        <PageBeacon />
      </body>
    </html>
  );
}
