import type { RoomChatResponse } from "@/lib/api/platform";
import { normalizeRoomCode } from "@/lib/livekit";
import { loadChatHistory } from "@/lib/roomSecret";
import {
  emitAdminEvent,
  internalRoute,
  parseAdminReason,
  platformError,
  platformJson,
  reasonRequired,
} from "@/lib/platform/internalAuth";

// GET /api/internal/rooms/<code>/chat?reason=<AdminReason> — чат комнаты для
// администрации. Только с причиной (по жалобе или сигналу), и само чтение — событие
// t=admin action=read_chat: читать переписку «просто так» не получится незаметно.

type Ctx = { params: Promise<{ code: string }> };

export const GET = internalRoute<Ctx>("chat", async (request, { params }) => {
  const code = normalizeRoomCode((await params).code);
  if (!code) return platformError(400, "bad_code", "Неверный код комнаты");
  const reason = parseAdminReason(new URL(request.url).searchParams.get("reason"));
  if (!reason) return reasonRequired();
  const history = await loadChatHistory(code);
  void emitAdminEvent("read_chat", { code, reason });
  const body: RoomChatResponse = {
    messages: history.map((m) => ({ name: m.from.name, text: m.text, at: m.ts })),
  };
  return platformJson(body);
});
