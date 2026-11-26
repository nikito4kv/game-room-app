import { NextResponse } from "next/server";
import { LEAD_TOKEN_HEADER } from "@/lib/api/contract";
import { clientIp, consumeLimit, leadReadLimit } from "@/lib/ratelimit";
import { errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { leadNotFound } from "@/lib/platform/leadResponses";
import { isLeadId, readThreadForUser } from "@/lib/platform/leadThreads";

// GET /api/leads/<id> с заголовком x-lead-token: <token> — заявка глазами автора
// (LeadThreadPublic). Токен — в заголовке, не в адресе: адреса оседают в логах и
// отчётах Sentry (в адресе ?t= остаётся только у страницы /request/<id> — это
// ссылка для человека). Чужой токен и несуществующая заявка неотличимы:
// LEAD_NOT_FOUND. Это чтение сбрасывает пометку «есть ответ».

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = await consumeLimit(leadReadLimit(), clientIp(request));
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
  const { id } = await params;
  const token = request.headers.get(LEAD_TOKEN_HEADER);
  if (!isLeadId(id) || !token) return leadNotFound();
  try {
    const thread = await readThreadForUser(id, token);
    if (!thread) return leadNotFound();
    return NextResponse.json(thread, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("lead read failed", err instanceof Error ? err.name : typeof err);
    return errorResponse(failureFrom(err));
  }
}
