import { ImageResponse } from "next/og";
import { roomCard, siteCard } from "@/lib/ogCard";
import { loadOgFonts } from "@/lib/ogFont";
import { getRoomMetaForOg } from "@/lib/ogRoomMeta";

// fs для шрифтов и логотипа → Node-рантайм (на edge fs недоступен).
export const runtime = "nodejs";

export const alt = "Приглашение в комнату Game Room";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Карточка приглашения: «Вас зовут в комнату», название и код. Комнаты нет
 * (или Redis не ответил) — карточка сайта. params в Next 16 — Promise.
 */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const upper = code.toUpperCase();
  const [meta, fonts] = await Promise.all([getRoomMetaForOg(upper), loadOgFonts()]);
  const card = meta ? await roomCard(meta, upper) : await siteCard();
  return new ImageResponse(card, { ...size, fonts });
}
