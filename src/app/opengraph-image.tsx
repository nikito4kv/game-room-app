import { ImageResponse } from "next/og";
import { siteCard } from "@/lib/ogCard";
import { loadOgFonts } from "@/lib/ogFont";

// fs для шрифтов и логотипа → Node-рантайм.
export const runtime = "nodejs";

export const alt = "Game Room: заходи, тут все свои. Голосовая комната для своей компании";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Карточка сайта для превью ссылок: главная, витрина и всё без своей картинки. */
export default async function Image() {
  const [fonts, card] = await Promise.all([loadOgFonts(), siteCard()]);
  return new ImageResponse(card, { ...size, fonts });
}
