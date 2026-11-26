import type { ReportStatus } from "@/lib/api/platform";
import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
  readInternalJson,
} from "@/lib/platform/internalAuth";
import { updateReport } from "@/lib/platform/reports";

// POST /api/internal/reports/<id> { status, resolution? } (ReportUpdateRequest) —
// решение по жалобе. Ответ — обновлённая жалоба.

const STATUSES: readonly ReportStatus[] = ["new", "resolved", "dismissed"];
type Ctx = { params: Promise<{ id: string }> };

export const POST = internalRoute<Ctx>("report_update", async (request, { params }) => {
  const { id } = await params;
  if (!/^[\w-]{4,40}$/.test(id)) return platformError(404, "not_found");
  const body = await readInternalJson(request);
  const status = STATUSES.find((s) => s === body?.status);
  if (!status) return platformError(400, "bad_status", "status — new, resolved или dismissed");
  const resolution =
    typeof body?.resolution === "string" && body.resolution.trim() ? body.resolution.trim().slice(0, 500) : null;
  const report = await updateReport(id, status, resolution);
  if (!report) return platformError(404, "not_found", "Жалобы нет");
  void emitAdminEvent(`report_${status}`, { code: report.code, reason: resolution ?? undefined });
  return platformJson(report);
});
