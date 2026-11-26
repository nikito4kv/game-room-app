import { checkLeadMessage } from "@/lib/leads";
import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
  readInternalJson,
} from "@/lib/platform/internalAuth";
import { isLeadId, teamReply } from "@/lib/platform/leadThreads";

// POST /api/internal/leads/<id>/reply { text } (LeadAdminReplyRequest) — ответ команды.
// Заявка становится «ответили», у автора появляется пометка «есть ответ».

type Ctx = { params: Promise<{ id: string }> };

export const POST = internalRoute<Ctx>("lead_reply", async (request, { params }) => {
  const { id } = await params;
  if (!isLeadId(id)) return platformError(404, "not_found", "Заявки нет");
  const body = await readInternalJson(request);
  const text = checkLeadMessage(body?.text);
  if (!text.ok) return platformError(400, "bad_text", text.message);
  const thread = await teamReply(id, text.text);
  if (!thread) return platformError(404, "not_found", "Заявки нет");
  void emitAdminEvent("lead_reply", { reason: id });
  return platformJson(thread);
});
