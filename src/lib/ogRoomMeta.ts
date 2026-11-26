import { unstable_cache } from "next/cache";
import type { RoomPublicMeta } from "@/lib/api/contract";
import { normalizeRoomCode } from "@/lib/livekit";
import { loadRoomMetaOrAdopt, toPublicMeta } from "@/lib/server/roomSync";

/**
 * Безопасное и кэшированное чтение описания комнаты для OG-превью ссылок.
 *  • Описание — из Redis (источник правды): превью работает, даже если LiveKit
 *    перезапускался и комнату ещё не пересоздали.
 *  • try/catch — сбой Redis/LiveKit или незаданные env не должны давать 500 в
 *    generateMetadata/opengraph-image: при ошибке — null («нет комнаты»).
 *  • unstable_cache — один разворот ссылки краулером = два запроса (HTML и
 *    картинка); короткий кэш склеивает их и гасит повторные развороты.
 */

// Кэшируется только успешный результат (включая законный null = «комнаты нет»).
const cachedLoad = unstable_cache(
  async (code: string): Promise<RoomPublicMeta | null> => {
    const meta = await loadRoomMetaOrAdopt(code);
    return meta ? toPublicMeta(meta) : null;
  },
  ["og-room-meta"],
  { revalidate: 60 },
);

/** Описание комнаты для OG. Никогда не бросает: при ошибке — null. */
export async function getRoomMetaForOg(rawCode: string): Promise<RoomPublicMeta | null> {
  const code = normalizeRoomCode(rawCode);
  if (!code) return null;
  try {
    // try/catch СНАРУЖИ кэша: отклонённый промис не кэшируется, и после
    // восстановления сети следующий запрос подтянет настоящее название.
    return await cachedLoad(code);
  } catch (err) {
    console.error("room meta (OG) failed", err);
    return null;
  }
}
