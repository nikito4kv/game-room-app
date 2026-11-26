import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/baseUrl";

// Карта сайта: только страницы, которые мы хотим видеть в поиске. Комнаты
// (/room/…) и «Открытые комнаты» (/rooms: список живой, меняется каждую минуту)
// сюда не входят. /check и /offer сюда не добавляем намеренно: у обеих страниц
// noindex (проверка связи и оферта не для поиска).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getBaseUrl();
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/clubs`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/rules`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
