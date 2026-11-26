import { normalizeRoomCode } from "@/lib/livekit";
import { loadRoomMeta } from "@/lib/roomSecret";
import {
  emitAdminEvent,
  internalRoute,
  parseAdminReason,
  platformError,
  platformJson,
  readInternalJson,
  reasonRequired,
} from "@/lib/platform/internalAuth";
import { adminMute } from "@/lib/platform/roomAdmin";

// POST /api/internal/rooms/<code>/mute { identity, reason, note? } (MuteRequest) —
// принудительный мьют (тот же, что у хоста: нельзя микрофон и звук показа). Хоста
// заглушить нельзя (права хоста это обходят) — для него 409: выгнать или закрыть.

type Ctx = { params: Promise<{ code: string }> };

export const POST = internalRoute<Ctx>("mute", async (request, { params }) => {
  const code = normalizeRoomCode((await params).code);
  if (!code) return platformError(400, "bad_code", "Неверный код комнаты");
  const body = await readInternalJson(request);
  if (!body) return platformError(400, "bad_request");
  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  if (!identity || identity.length > 80) return platformError(400, "bad_identity", "Не указан участник");
  const reason = parseAdminReason(body.reason);
  if (!reason) return reasonRequired();
  const meta = await loadRoomMeta(code);
  if (!meta) return platformError(404, "room_not_found", "Комнаты нет");
  if (meta.hostIdentity === identity) {
    return platformError(409, "target_is_host", "Хоста заглушить нельзя — выгоните его или закройте комнату");
  }
  await adminMute(code, identity);
  void emitAdminEvent("mute", { code, identity, reason });
  return platformJson({ ok: true });
});
