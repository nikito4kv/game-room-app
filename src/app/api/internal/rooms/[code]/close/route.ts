import { CHAT_MAX_LENGTH } from "@/lib/api/contract";
import { getRoomService, normalizeRoomCode } from "@/lib/livekit";
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
import { closeRoom } from "@/lib/platform/roomAdmin";

// POST /api/internal/rooms/<code>/close { reason, note?, message? } — закрыть
// комнату (CloseRoomRequest). message — что увидят в чате и на экране «комната
// закрыта» (до CHAT_MAX_LENGTH символов); вход в код закрыт на сутки.

type Ctx = { params: Promise<{ code: string }> };

export const POST = internalRoute<Ctx>("close", async (request, { params }) => {
  const code = normalizeRoomCode((await params).code);
  if (!code) return platformError(400, "bad_code", "Неверный код комнаты");
  const body = await readInternalJson(request);
  if (!body) return platformError(400, "bad_request");
  const reason = parseAdminReason(body.reason);
  if (!reason) return reasonRequired();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if ([...message].length > CHAT_MAX_LENGTH) {
    return platformError(400, "message_too_long", `Сообщение — до ${CHAT_MAX_LENGTH} символов`);
  }
  // Закрыть можно только существующую комнату (в Redis или в LiveKit): иначе опечатка
  // в коде молча «закрыла бы» чужой будущий код на сутки.
  const [meta, live] = await Promise.all([loadRoomMeta(code), getRoomService().listRooms([code])]);
  if (!meta && live.length === 0) return platformError(404, "room_not_found", "Комнаты с таким кодом нет");
  const removed = await closeRoom(code, { reason, message });
  void emitAdminEvent("close", { code, reason });
  return platformJson({ ok: true, removed });
});
