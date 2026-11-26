import { NextResponse } from "next/server";
import { AVATAR_MAX_BYTES, type AvatarResponse } from "@/lib/api/contract";
import { normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import { avatarLimit, avatarNewIpLimit, avatarNewRoomLimit, clientNet, consumeLimit } from "@/lib/ratelimit";
import {
  applyAvatarAttribute,
  avatarIdOf,
  avatarRefusal,
  consumeAvatarBudget,
  parseAvatarBody,
  putAvatar,
  refreshAvatar,
} from "@/lib/server/avatar";
import { AVATAR_BANNED_MESSAGE, apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { optionalString } from "@/lib/server/request";
import { getParticipantOrNull } from "@/lib/server/roomSync";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce } from "@/lib/platform/signals";

// POST /api/avatar — свой рисунок Румика видят другие в комнате (R4). Контракт —
// AvatarRequest в src/lib/api/contract.ts. Как у /api/voice: кому писать, сервер
// берёт из подписи токена (не из тела), и только тому, кто сейчас в комнате;
// пишем атрибут участника LiveKit, metadata с решениями хоста не трогаем.
// Картинку кладём ДО атрибута: увидевший новый id сразу её скачает. Новый
// рисунок (которого ещё нет на сервере) проходит три потолка: с адреса, на
// комнату и суточный бюджет всего сайта, — хранилище не забить ни с одного
// адреса, ни из одной комнаты, ни вообще.

/** Тело: base64 картинки (до AVATAR_MAX_BYTES × 4/3) и короткие поля (код, токен); больше — не наш клиент. */
const MAX_BODY_BYTES = Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 4 * 1024;

/** Тело как текст, не больше max байт; больше — null (дочитывать не станем). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return errorResponse(apiError("AVATAR_INVALID"));
  const body = parseObject(text);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  // Выключатель администрации (флаг по комнате).
  if (!isFlagOn(await loadRuntimeConfig(), "rumik_share", code)) {
    return errorResponse(apiError("FEATURE_DISABLED", "Рисунки в комнатах временно выключены"));
  }

  // Лимит — до разбора картинки: распаковка PNG стоит процессора.
  const limit = await consumeLimit(avatarLimit(), `${code}:${caller.identity}`);
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  const parsed = parseAvatarBody(body);
  if (!parsed.ok) {
    return errorResponse(apiError(parsed.problem === "bad_request" ? "BAD_REQUEST" : "AVATAR_INVALID"));
  }

  try {
    if (parsed.png === null) {
      if (!(await applyAvatarAttribute(code, caller.identity, null))) return errorResponse(apiError("NOT_IN_ROOM"));
      const response: AvatarResponse = { ok: true, id: null };
      return NextResponse.json(response);
    }

    const id = avatarIdOf(parsed.png);
    const refusal = await avatarRefusal(code, caller.identity, id);
    if (refusal) {
      return errorResponse(apiError("AVATAR_BLOCKED", refusal === "person" ? AVATAR_BANNED_MESSAGE : undefined));
    }
    // Не в комнате — и хранить нечего: картинку кладём только тем, кого увидят.
    if (!(await getParticipantOrNull(code, caller.identity))) return errorResponse(apiError("NOT_IN_ROOM"));
    // Тот же рисунок уже лежит — только продлеваем срок; новый тратит лимиты.
    if (!(await refreshAvatar(id))) {
      const byNet = await consumeLimit(avatarNewIpLimit(), clientNet(request));
      if (byNet.limited) return errorResponse(retryError("RATE_LIMITED", byNet.retryAfterSec));
      const byRoom = await consumeLimit(avatarNewRoomLimit(), code);
      if (byRoom.limited) return errorResponse(retryError("RATE_LIMITED", byRoom.retryAfterSec));
      if (!(await consumeAvatarBudget(parsed.png.length))) return errorResponse(apiError("AVATAR_LIMIT"));
      await putAvatar(id, parsed.png);
    }
    // Запись — она же проверка «всё ещё в комнате»: ушедшего LiveKit не найдёт.
    if (!(await applyAvatarAttribute(code, caller.identity, id))) return errorResponse(apiError("NOT_IN_ROOM"));
    void emitFeatureOnce("avatar", code, caller.identity);
    const response: AvatarResponse = { ok: true, id };
    return NextResponse.json(response);
  } catch (err) {
    console.error("avatar: update failed", err);
    return errorResponse(failureFrom(err));
  }
}
