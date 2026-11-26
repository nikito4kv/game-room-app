// ВАЖНО: только сервер. Пропуск во внутренний API /api/internal/* (для агента
// админки). Снаружи этот путь закрывает Caddy (404), но сайт проверяет и сам:
// заголовок x-internal-token должен совпасть с INTERNAL_API_TOKEN.
//
// Переменная не задана (или короче 32 символов) — внутренний API выключен целиком
// (503): забытый токен не должен превращаться в «пускать всех».
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ADMIN_REASONS,
  INTERNAL_TOKEN_HEADER,
  type AdminReason,
  type PlatformError,
} from "@/lib/api/platform";
import { emitEvent } from "./events";

const MIN_TOKEN_LENGTH = 32;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Ошибка внутреннего API (форма PlatformError). */
export function platformError(status: number, error: string, message?: string): NextResponse {
  const body: PlatformError = message ? { error, message } : { error };
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Успешный ответ внутреннего API. */
export function platformJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * null — пропускаем; иначе готовый отказ (503 — API выключен, 401 — чужой).
 * Сравнение за постоянное время: хэши одинаковой длины → timingSafeEqual.
 */
export function checkInternalAuth(request: Request): NextResponse | null {
  const expected = process.env.INTERNAL_API_TOKEN ?? "";
  if (expected.length < MIN_TOKEN_LENGTH) {
    return platformError(503, "internal_disabled", "Внутренний API выключен: не задан INTERNAL_API_TOKEN");
  }
  const got = request.headers.get(INTERNAL_TOKEN_HEADER) ?? "";
  if (!got || !timingSafeEqual(digest(got), digest(expected))) {
    return platformError(401, "unauthorized");
  }
  return null;
}

type Handler<C> = (request: Request, ctx: C) => Promise<Response>;

/**
 * Обёртка маршрута: проверка токена и единый ответ на непредвиденный сбой (без
 * подробностей наружу — они в логе).
 */
export function internalRoute<C>(name: string, handler: Handler<C>): Handler<C> {
  return async (request, ctx) => {
    const denied = checkInternalAuth(request);
    if (denied) return denied;
    try {
      return await handler(request, ctx);
    } catch (err) {
      console.error(`internal ${name} failed`, err);
      return platformError(503, "unavailable", "Redis или LiveKit не ответили — повторите позже");
    }
  };
}

/** Тело запроса — объект JSON не больше maxBytes; иначе null. */
export async function readInternalJson(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── Общее для внутренних маршрутов ──────────────────────────────────────────

const ADMIN_REASON_KEYS = Object.keys(ADMIN_REASONS) as AdminReason[];

/** Причина действия администрации из тела запроса; null — нет или неизвестна. */
export function parseAdminReason(x: unknown): AdminReason | null {
  return ADMIN_REASON_KEYS.find((r) => r === x) ?? null;
}

export const reasonRequired = () =>
  platformError(400, "reason_required", "Нужна причина из списка ADMIN_REASONS");

/** Событие t=admin в поток: любое изменяющее действие администрации. */
export function emitAdminEvent(action: string, ctx: { code?: string; identity?: string; reason?: string }): Promise<void> {
  return emitEvent({ t: "admin", action, ...ctx });
}
