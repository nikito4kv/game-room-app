import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/baseUrl";

// Поисковикам можно всё публичное. Закрыто: комнаты (код в адресе — это ключ
// входа, в выдаче ему делать нечего), API и витрина дизайн-системы.
export default function robots(): MetadataRoute.Robots {
  const base = getBaseUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/room/", "/api/", "/design", "/check", "/offer"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
