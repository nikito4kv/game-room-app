import { isAvatarId } from "@/lib/api/contract";
import type { AvatarResetResponse } from "@/lib/api/platform";
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
import { resetAvatar } from "@/lib/server/avatar";

// POST /api/internal/rooms/<code>/avatar-reset { identity, avatarId?, reason, note? }
// (AvatarResetRequest) — «сбросить рисунок». Скрываются для всех (тот
// же загрузить нельзя до конца срока хранения; картинку видит только админка)
// рисунок, который сейчас у участника (сервер читает его атрибут сам), и
// avatarId из запроса — тот, что видела администрация. Атрибут снимается —
// остальные сразу видят обычного Румика его цвета, — и новые рисунки этого участника в
// комнате не принимаются, пока она жива. Человек мог уже уйти: тогда скрывается
// рисунок из запроса (из жалобы).

type Ctx = { params: Promise<{ code: string }> };

export const POST = internalRoute<Ctx>("avatar-reset", async (request, { params }) => {
  const code = normalizeRoomCode((await params).code);
  if (!code) return platformError(400, "bad_code", "Неверный код комнаты");
  const body = await readInternalJson(request);
  if (!body) return platformError(400, "bad_request");
  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  if (!identity || identity.length > 80) return platformError(400, "bad_identity", "Не указан участник");
  const avatarId = body.avatarId === undefined || body.avatarId === null ? null : body.avatarId;
  if (avatarId !== null && !isAvatarId(avatarId)) return platformError(400, "bad_avatar", "Неверный id рисунка");
  const reason = parseAdminReason(body.reason);
  if (!reason) return reasonRequired();
  const result = await resetAvatar(code, identity, avatarId, reason);
  if (!result.ok) return platformError(404, "no_avatar", "У участника нет рисунка — сбрасывать нечего");
  void emitAdminEvent("avatar_reset", { code, identity, reason });
  const response: AvatarResetResponse = {
    ok: true,
    avatarId: result.avatarId,
    cleared: result.cleared,
    hidden: result.hidden,
  };
  return platformJson(response);
});
