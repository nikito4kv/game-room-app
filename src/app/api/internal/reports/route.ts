import type { ReportsResponse } from "@/lib/api/platform";
import { internalRoute, platformJson } from "@/lib/platform/internalAuth";
import { listReports } from "@/lib/platform/reports";

// GET /api/internal/reports?status=new|all&cursor= — очередь жалоб, новые первыми,
// страницами до 100 (ReportsResponse + nextCursor: откуда продолжать; null — всё).

export const GET = internalRoute("reports", async (request) => {
  const q = new URL(request.url).searchParams;
  const status = q.get("status") === "all" ? "all" : "new";
  const body: ReportsResponse & { nextCursor: string | null } = await listReports({
    status,
    cursor: q.get("cursor"),
  });
  return platformJson(body);
});
