import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { DataPacket_Kind } from "livekit-server-sdk";
import {
  CHAT_TOPIC,
  type ApiError,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatPostResponse,
} from "@/lib/api/contract";
import { getRoomService, normalizeRoomCode, verifyParticipantToken } from "@/lib/livekit";
import {
  appendChatMessage,
  loadChatHistory,
  loadRoomFlags,
  touchRoomState,
} from "@/lib/roomSecret";
import { chatHistoryLimit, chatLimit, clientIp, consumeLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { checkChatPolicy, validateChatText } from "@/lib/server/chatRules";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { getParticipantOrNull } from "@/lib/server/roomSync";
import { detectChatFlag } from "@/lib/platform/chatFlags";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce, emitSignal } from "@/lib/platform/signals";

// Чат через сервер. Контракт — src/lib/api/contract.ts (ChatMessage и др.).
//  • POST /api/chat — отправить. Автора ставит сервер по подписи токена, поэтому
//    подделать отправителя нельзя; политика чата и запреты хоста проверяются здесь.
//    Рассылка — data-пакет LiveKit от имени сервера, тема CHAT_TOPIC, всем.
//  • GET /api/chat?code=… (Authorization: Bearer <token>) — история для вошедшего.
// Своих data-пакетов клиенты слать не могут (canPublishData: false).

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  const text = validateChatText(body.text);
  if (!text.ok) return errorResponse(text.error);

  // Аварийный выключатель чата (настройки продукта).
  if (!isFlagOn(await loadRuntimeConfig(), "chat", code)) {
    return errorResponse(apiError("CHAT_DISABLED", "Чат временно выключен администрацией"));
  }

  const limit = await consumeLimit(chatLimit(), `${code}:${caller.identity}`);
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  try {
    const [{ meta, flags }, participant] = await Promise.all([
      loadRoomFlags(code),
      getParticipantOrNull(code, caller.identity),
    ]);
    if (!meta) return errorResponse(apiError("ROOM_NOT_FOUND"));
    if (!participant) return errorResponse(apiError("NOT_IN_ROOM"));
    const refusal: ApiError | null = checkChatPolicy(meta.settings.chat, {
      isHost: meta.hostIdentity === caller.identity,
      chatMuted: flags.chatMuted.has(caller.identity),
    });
    if (refusal) return errorResponse(refusal);

    const message: ChatMessage = {
      id: randomBytes(12).toString("base64url"),
      ts: Date.now(),
      // Ник — текущий из LiveKit (мог смениться после выдачи токена).
      from: { identity: caller.identity, name: participant.name || caller.name || caller.identity },
      text: text.text,
    };
    // Сначала рассылка: не дошло — клиент получит ошибку и повторит, а в истории
    // не появится сообщение, которого никто не видел.
    await getRoomService().sendData(
      code,
      encoder.encode(JSON.stringify(message)),
      DataPacket_Kind.RELIABLE,
      { topic: CHAT_TOPIC },
    );
    await Promise.all([
      appendChatMessage(code, message).catch((err) => console.error("chat history append failed", err)),
      touchRoomState(code).catch((err) => console.error("room ttl touch failed", err)),
    ]);
    // Подозрительные слова — не повод не доставить сообщение, а сигнал админке.
    const flagged = detectChatFlag(message.text);
    if (flagged) {
      void emitSignal("chat_flag", "medium", {
        code,
        identity: caller.identity,
        detail: `${flagged.category}: ${flagged.excerpt}`,
      });
    }
    void emitFeatureOnce("chat", code, caller.identity);
    const response: ChatPostResponse = { message };
    return NextResponse.json(response);
  } catch (err) {
    console.error("chat: send failed", err);
    return errorResponse(failureFrom(err));
  }
}

export async function GET(request: Request) {
  const limit = await consumeLimit(chatHistoryLimit(), clientIp(request));
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  const code = normalizeRoomCode(new URL(request.url).searchParams.get("code"));
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  // Токен — в заголовке, а не в адресе: адреса оседают в логах прокси.
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const caller = token ? await verifyParticipantToken(token, code) : null;
  if (!caller) return errorResponse(apiError("UNAUTHORIZED"));

  try {
    // История — только тем, кто сейчас в комнате: выгнанный не дочитает чат
    // старым токеном.
    if (!(await getParticipantOrNull(code, caller.identity))) {
      return errorResponse(apiError("NOT_IN_ROOM"));
    }
    const response: ChatHistoryResponse = { messages: await loadChatHistory(code) };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("chat: history failed", err);
    return errorResponse(failureFrom(err));
  }
}
