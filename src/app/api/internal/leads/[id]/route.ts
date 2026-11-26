import { internalRoute, platformError, platformJson } from "@/lib/platform/internalAuth";
import { adminView, loadThread } from "@/lib/platform/leadThreads";

// GET /api/internal/leads/<id> — заявка целиком (LeadThreadAdmin). Пометку «есть
// ответ» у автора не трогает.

type Ctx = { params: Promise<{ id: string }> };

export const GET = internalRoute<Ctx>("lead", async (_request, { params }) => {
  const thread = await loadThread((await params).id);
  if (!thread) return platformError(404, "not_found", "Заявки нет");
  return platformJson(adminView(thread));
});
