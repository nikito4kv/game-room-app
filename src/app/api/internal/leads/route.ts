import type { LeadsListResponse } from "@/lib/api/platform";
import { internalRoute, platformError, platformJson } from "@/lib/platform/internalAuth";
import {
  isLeadStatus,
  listThreads,
  migrateLegacyLeads,
  purgeOldThreads,
} from "@/lib/platform/leadThreads";

// GET /api/internal/leads?status=&cursor= — ящик заявок (LeadsListResponse), свежие
// сверху. Заодно: перенос старых заявок leads:v1 (один раз) и удаление диалогов
// старше LEAD_RETENTION_DAYS (не чаще раза в 6 часов).

export const GET = internalRoute("leads", async (request) => {
  const q = new URL(request.url).searchParams;
  const rawStatus = q.get("status");
  if (rawStatus && rawStatus !== "all" && !isLeadStatus(rawStatus)) {
    return platformError(400, "bad_status", "status — new, in_progress, answered, paying, closed или all");
  }
  await migrateLegacyLeads().catch((err: unknown) => console.error("leads migration failed", err));
  await purgeOldThreads().catch((err: unknown) => console.error("leads purge failed", err));
  const body: LeadsListResponse = await listThreads({
    status: rawStatus && isLeadStatus(rawStatus) ? rawStatus : null,
    cursor: q.get("cursor"),
  });
  return platformJson(body);
});
