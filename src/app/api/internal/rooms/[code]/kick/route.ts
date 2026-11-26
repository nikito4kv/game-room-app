import { normalizeRoomCode } from "@/lib/livekit";
import {
  emitAdminEvent,
  internalRoute,
  parseAdminReason,
  platformError,
  platformJson,
  readInternalJson,
  reasonRequired,
} from "@/lib/platform/internalAuth";
import { ADMIN_KICK_MINUTES_MAX, adminKick } from "@/lib/platform/roomAdmin";

// POST /api/internal/rooms/<code>/kick { identity, minutes, reason, note? }
// (KickRequest): выгнать на minutes минут или (minutes: null) закрыть вход в эту
// комнату навсегда. Действует и на владельца комнаты. Человек видит причину
// admin_kick / admin_ban. Блок устройства на весь сайт — отдельно (/blocks).

type Ctx = { params: Promise<{ code: string }> };

export const POST = internalRoute<Ctx>("kick", async (request, { params }) => {
  const code = normalizeRoomCode((await params).code);
  if (!code) return platformError(400, "bad_code", "Неверный код комнаты");
  const body = await readInternalJson(request);
  if (!body) return platformError(400, "bad_request");
  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  if (!identity || identity.length > 80) return platformError(400, "bad_identity", "Не указан участник");
  const reason = parseAdminReason(body.reason);
  if (!reason) return reasonRequired();
  let minutes: number | null = null;
  if (body.minutes !== null) {
    const m = body.minutes;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > ADMIN_KICK_MINUTES_MAX) {
      return platformError(
        400,
        "bad_minutes",
        `Срок — целое число минут от 1 до ${ADMIN_KICK_MINUTES_MAX} или null (навсегда в этой комнате)`,
      );
    }
    minutes = m;
  }
  const wasPresent = await adminKick(code, identity, minutes, reason);
  void emitAdminEvent(minutes === null ? "ban" : "kick", { code, identity, reason });
  return platformJson({ ok: true, wasPresent });
});
