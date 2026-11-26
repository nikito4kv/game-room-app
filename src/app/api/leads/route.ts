import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { LeadCreateResponse } from "@/lib/api/platform";
import { validateLeadCreate } from "@/lib/leads";
import { leadLimit } from "@/lib/leadsStore";
import { clientIp, consumeLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { readJsonObject } from "@/lib/server/request";
import { emitEvent } from "@/lib/platform/events";
import { invalidLead, leadsDisabled } from "@/lib/platform/leadResponses";
import {
  claimLeadFingerprint,
  createLeadThread,
  leadFingerprint,
  releaseLeadFingerprint,
} from "@/lib/platform/leadThreads";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitSignalOnce } from "@/lib/platform/signals";

// POST /api/leads — новая заявка-диалог (LeadCreateRequest в src/lib/api/platform.ts).
// Ответ — личная ссылка /request/<id>?t=<token>: по ней человек видит ответы
// команды и дописывает. Токен показываем один раз, храним только его хэш.
// Хранение — src/lib/platform/leadThreads.ts; проверка полей — validateLeadCreate.
//
// Персональные данные (контакт, текст) в лог не пишем: при сбое — только имя ошибки.

/** Заявка — несколько коротких полей и сообщение до 2000 символов. */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(apiError("BAD_REQUEST", "Слишком большой запрос"));
  }
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  if (!isFlagOn(await loadRuntimeConfig(), "leads")) return leadsDisabled();

  try {
    const ip = clientIp(request);
    const limit = await consumeLimit(leadLimit(), ip);
    if (limit.limited) {
      void emitSignalOnce(ip, 600, "lead_spam", "medium", { ip, detail: "лимит заявок с одного адреса" });
      return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
    }

    // Ловушка для ботов: невидимое поле «website». Человек его не заполнит. Отвечаем
    // правдоподобно (ненастоящие id и токен), чтобы бот не искал обход.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      const id = randomBytes(9).toString("base64url");
      const token = randomBytes(24).toString("base64url");
      const fake: LeadCreateResponse = { ok: true, id, token, url: `/request/${id}?t=${token}` };
      return NextResponse.json(fake);
    }

    const result = validateLeadCreate(body);
    if (!result.ok) return invalidLead(result.errors);

    // Та же заявка за 10 минут — отказ (двойной клик, повтор после обрыва).
    const fp = leadFingerprint(result.lead);
    if (!(await claimLeadFingerprint(fp))) return errorResponse(apiError("LEAD_DUPLICATE"));
    const created = await createLeadThread(result.lead).catch(async (err: unknown) => {
      await releaseLeadFingerprint(fp);
      throw err;
    });
    if (!created.ok) {
      await releaseLeadFingerprint(fp);
      void emitSignalOnce("daily", 3600, "lead_spam", "high", { detail: "исчерпан суточный потолок заявок" });
      return errorResponse(
        apiError("SERVICE_UNAVAILABLE", "Сегодня мы больше не принимаем заявки. Попробуйте завтра"),
      );
    }
    const { thread, token } = created;
    void emitEvent({ t: "lead", leadId: thread.id, kind: thread.kind, product: thread.product });
    const response: LeadCreateResponse = {
      ok: true,
      id: thread.id,
      token,
      url: `/request/${thread.id}?t=${token}`,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("leads: failed", err instanceof Error ? err.name : typeof err);
    return errorResponse(failureFrom(err));
  }
}
