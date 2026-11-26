import { isAvatarId } from "@/lib/api/contract";
import { internalRoute, platformError } from "@/lib/platform/internalAuth";
import { loadAvatarForAdmin } from "@/lib/server/avatar";

// GET /api/internal/avatar/<id> — картинка рисунка Румика для админки (жалоба,
// карточка участника, журнал): посмотреть, прежде чем сбрасывать, и после
// сброса — скрытый рисунок отдаётся только здесь (заголовок X-Avatar-Hidden: 1),
// пока жива жалоба на него. Без кеша и без лимита по адресу — сюда ходит только
// агент. Нет или истёк — 404.

type Ctx = { params: Promise<{ id: string }> };

export const GET = internalRoute<Ctx>("avatar", async (_request, { params }) => {
  const { id } = await params;
  if (!isAvatarId(id)) return platformError(404, "not_found");
  const found = await loadAvatarForAdmin(id);
  if (!found) return platformError(404, "not_found", "Рисунка нет: истёк срок хранения");
  return new Response(new Uint8Array(found.png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      ...(found.hidden ? { "X-Avatar-Hidden": "1" } : {}),
    },
  });
});
