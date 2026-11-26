import { NextResponse } from "next/server";
import type { ReportResponse } from "@/lib/api/platform";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { loadChatHistory, loadName, loadRoomMeta } from "@/lib/roomSecret";
import { clientIp, consumeLimit, reportIpLimit, reportLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { avatarIdOfParticipant } from "@/lib/server/avatar";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { getParticipantOrNull } from "@/lib/server/roomSync";
import { cleanNote } from "@/lib/leads";
import { emitEvent } from "@/lib/platform/events";
import {
  REPORT_NOTE_MAX,
  chatSnapshot,
  createReport,
  isReportReason,
} from "@/lib/platform/reports";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitSignalOnce } from "@/lib/platform/signals";

// POST /api/report — «Пожаловаться» из комнаты (ReportRequest в src/lib/api/platform.ts).
// Автор — по подписи LiveKit-токена, как в чате: подделать жалобу «от другого»
// нельзя. В жалобу кладём снимок последних сообщений чата — основание для решения
// администрации, когда комнаты уже не будет. Лимит — 5 за 10 минут на участника
// и на адрес; сверх него — сигнал report_spam. Плюс суточный потолок на весь сайт
// (MAX_REPORTS_PER_DAY): сверх него — 429 до полуночи UTC и сигнал high.

const MAX_BODY_BYTES = 4 * 1024;

/** Сколько секунд до полуночи UTC — когда сбросится суточный потолок жалоб. */
function secondsToUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(apiError("BAD_REQUEST", "Слишком большой запрос"));
  }
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));
  if (!isReportReason(body.reason)) return errorResponse(apiError("BAD_REQUEST", "Выберите причину жалобы"));
  const reason = body.reason;
  const note = cleanNote(body.note);
  if ([...note].length > REPORT_NOTE_MAX) {
    return errorResponse(apiError("BAD_REQUEST", `Комментарий — не больше ${REPORT_NOTE_MAX} символов`));
  }
  const target = optionalString(body.targetIdentity)?.slice(0, 80) ?? null;

  if (!isFlagOn(await loadRuntimeConfig(), "reports", code)) {
    return errorResponse(apiError("FEATURE_DISABLED", "Жалобы временно не принимаются. Попробуйте позже"));
  }

  const ip = clientIp(request);
  const [byPerson, byIp] = await Promise.all([
    consumeLimit(reportLimit(), `${code}:${caller.identity}`),
    consumeLimit(reportIpLimit(), ip),
  ]);
  const limited = byPerson.limited ? byPerson : byIp.limited ? byIp : null;
  if (limited) {
    void emitSignalOnce(`${ip}:${caller.identity}`, 600, "report_spam", "medium", {
      code,
      identity: caller.identity,
      ip,
    });
    return errorResponse(retryError("RATE_LIMITED", limited.retryAfterSec));
  }

  try {
    const meta = await loadRoomMeta(code);
    if (!meta) return errorResponse(apiError("ROOM_NOT_FOUND"));
    const [history, reporterName, targetName, targetAvatarId] = await Promise.all([
      loadChatHistory(code),
      loadName(code, caller.identity),
      target ? loadName(code, target) : Promise.resolve(null),
      // Рисунок Румика нарушителя — чтобы админ увидел его и мог сбросить (R4).
      // Не вышло узнать — жалоба важнее, идём без него.
      target
        ? getParticipantOrNull(code, target).then((p) => (p ? avatarIdOfParticipant(p) : null), () => null)
        : Promise.resolve(null),
    ]);
    const created = await createReport({
      code,
      reporterIdentity: caller.identity,
      reporterName: reporterName ?? (caller.name || null),
      targetIdentity: target,
      targetName,
      reason,
      note,
      chatSnapshot: chatSnapshot(history),
      targetAvatarId,
    });
    if (!created.ok) {
      // Суточный потолок сайта: это залив, а не люди. Честный отказ «позже» и
      // громкий сигнал админке (не чаще раза в час).
      void emitSignalOnce("daily", 3600, "report_spam", "high", { detail: "исчерпан суточный потолок жалоб" });
      return errorResponse(retryError("RATE_LIMITED", secondsToUtcMidnight()));
    }
    const { report } = created;
    void emitEvent({ t: "report", reportId: report.id, code, reason });
    const response: ReportResponse = { ok: true, id: report.id };
    return NextResponse.json(response);
  } catch (err) {
    console.error("report: failed", err);
    return errorResponse(failureFrom(err));
  }
}
