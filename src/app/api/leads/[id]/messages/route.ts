import { NextResponse } from "next/server";
import { LEAD_TOKEN_HEADER } from "@/lib/api/contract";
import { checkLeadMessage } from "@/lib/leads";
import { clientIp, consumeLimit, leadMessageLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { readJsonObject } from "@/lib/server/request";
import { emitEvent } from "@/lib/platform/events";
import { invalidLead, leadNotFound, leadsDisabled } from "@/lib/platform/leadResponses";
import { addUserMessage, isLeadId } from "@/lib/platform/leadThreads";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitSignalOnce } from "@/lib/platform/signals";

// POST /api/leads/<id>/messages { t, text } — автор дописывает в свою заявку
// (LeadReplyRequest). Токен — заголовком x-lead-token (так шлёт наш клиент) или,
// по контракту, полем t тела. Ответ — обновлённая переписка (LeadThreadPublic).

const MAX_BODY_BYTES = 12 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(apiError("BAD_REQUEST", "Слишком большой запрос"));
  }
  const { id } = await params;
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const token = request.headers.get(LEAD_TOKEN_HEADER) || (typeof body.t === "string" ? body.t : "");
  if (!isLeadId(id) || !token) return leadNotFound();
  if (!isFlagOn(await loadRuntimeConfig(), "leads")) return leadsDisabled();

  const text = checkLeadMessage(body.text);
  if (!text.ok) return invalidLead({ message: text.message });

  const ip = clientIp(request);
  const limit = await consumeLimit(leadMessageLimit(), ip);
  if (limit.limited) {
    void emitSignalOnce(`msg:${ip}`, 600, "lead_spam", "medium", { ip, detail: "много сообщений в заявки" });
    return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
  }

  try {
    const res = await addUserMessage(id, token, text.text);
    if (!res.ok) {
      return res.reason === "too_many"
        ? errorResponse(apiError("BAD_REQUEST", "В этой заявке слишком много сообщений. Создайте новую"))
        : leadNotFound();
    }
    void emitEvent({ t: "lead_msg", leadId: id });
    return NextResponse.json(res.thread);
  } catch (err) {
    console.error("lead message failed", err instanceof Error ? err.name : typeof err);
    return errorResponse(failureFrom(err));
  }
}
