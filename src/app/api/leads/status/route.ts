import { NextResponse } from "next/server";
import type { LeadStatusBatchResponse } from "@/lib/api/platform";
import { clientIp, consumeLimit, leadReadLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { readJsonObject } from "@/lib/server/request";
import { statusBatch } from "@/lib/platform/leadThreads";

// POST /api/leads/status { items: [{ id, t }] } — пометки «есть ответ» для шапки
// сайта (LeadStatusBatchRequest). Чужие и несуществующие заявки просто не попадают
// в ответ. Не больше 20 заявок за раз.

const MAX_ITEMS = 20;

export async function POST(request: Request) {
  const limit = await consumeLimit(leadReadLimit(), clientIp(request));
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
  const body = await readJsonObject(request);
  if (!body || !Array.isArray(body.items)) return errorResponse(apiError("BAD_REQUEST"));
  const items = body.items
    .slice(0, MAX_ITEMS)
    .flatMap((x: unknown) =>
      typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string" &&
      typeof (x as { t?: unknown }).t === "string"
        ? [{ id: (x as { id: string }).id, t: (x as { t: string }).t }]
        : [],
    );
  try {
    const response: LeadStatusBatchResponse = { items: await statusBatch(items) };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("lead status failed", err instanceof Error ? err.name : typeof err);
    return errorResponse(failureFrom(err));
  }
}
