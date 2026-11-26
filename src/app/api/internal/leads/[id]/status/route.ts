import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
  readInternalJson,
} from "@/lib/platform/internalAuth";
import { isLeadId, isLeadStatus, loadThread, adminView, setThreadStatus } from "@/lib/platform/leadThreads";

// POST /api/internal/leads/<id>/status { status } (LeadStatusRequest) — статус заявки.

type Ctx = { params: Promise<{ id: string }> };

export const POST = internalRoute<Ctx>("lead_status", async (request, { params }) => {
  const { id } = await params;
  if (!isLeadId(id)) return platformError(404, "not_found", "Заявки нет");
  const body = await readInternalJson(request);
  if (!isLeadStatus(body?.status)) {
    return platformError(400, "bad_status", "status — new, in_progress, answered, paying или closed");
  }
  const updated = await setThreadStatus(id, body.status);
  const thread = updated ?? (await loadThread(id).then((t) => (t ? adminView(t) : null)));
  if (!thread) return platformError(404, "not_found", "Заявки нет");
  void emitAdminEvent("lead_status", { reason: `${id}: ${body.status}` });
  return platformJson(thread);
});
