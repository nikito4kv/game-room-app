import { CHAT_MAX_LENGTH } from "@/lib/api/contract";
import { normalizeRoomCode } from "@/lib/livekit";
import { loadRoomMeta } from "@/lib/roomSecret";
import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
  readInternalJson,
} from "@/lib/platform/internalAuth";
import { sendSystemChatMessage } from "@/lib/server/roomSync";

// POST /api/internal/rooms/<code>/message { text } (RoomMessageRequest) — системное
// сообщение всей комнате («сервер перезапускается через 5 минут»). Идёт по пути
// чата: data-пакет CHAT_TOPIC, автор «Администрация», признак system: true.

type Ctx = { params: Promise<{ code: string }> };

export const POST = internalRoute<Ctx>("message", async (request, { params }) => {
  const code = normalizeRoomCode((await params).code);
  if (!code) return platformError(400, "bad_code", "Неверный код комнаты");
  const body = await readInternalJson(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || [...text].length > CHAT_MAX_LENGTH) {
    return platformError(400, "bad_text", `Текст — от 1 до ${CHAT_MAX_LENGTH} символов`);
  }
  if (!(await loadRoomMeta(code))) return platformError(404, "room_not_found", "Комнаты нет");
  const message = await sendSystemChatMessage(code, text);
  void emitAdminEvent("message", { code });
  return platformJson({ ok: true, id: message.id });
});
