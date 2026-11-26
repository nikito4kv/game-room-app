// ВАЖНО: этот модуль импортируется только из серверного кода (маршруты /api/*).
// Секреты LiveKit не должны попадать в клиентские компоненты.
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  AccessToken,
  RoomServiceClient,
  TokenVerifier,
  TwirpError,
  WebhookReceiver,
} from "livekit-server-sdk";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./roomCode";
import type { FullParticipantPermission } from "./server/permissions";

/**
 * Серверные хелперы LiveKit и секретов: клиенты Server API, проверка и выпуск
 * токенов, хэши пароля, ключа владельца и секрета места. Ключи LiveKit
 * (LIVEKIT_API_KEY / LIVEKIT_API_SECRET) живут только здесь.
 */

const scryptAsync = promisify(scrypt);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name} (см. .env.local)`);
  }
  return value;
}

// Server API ходит по http(s), а LIVEKIT_URL может быть в виде ws(s):// — конвертируем.
function httpHost(): string {
  return requireEnv("LIVEKIT_URL").replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

/** Публичный адрес LiveKit для клиента. */
export function getServerUrl(): string {
  return requireEnv("NEXT_PUBLIC_LIVEKIT_URL");
}

// По умолчанию SDK ждёт ответа 60 с: при зависшем LiveKit вход висел бы минуту.
// LiveKit — на той же машине, нормальный ответ — миллисекунды.
const LIVEKIT_REQUEST_TIMEOUT_SEC = 5;
/**
 * Для необязательных чтений (превью комнаты в лобби): не ответил быстро — ответ
 * собирается без LiveKit, а не ждёт и не падает.
 */
export const LIVEKIT_QUICK_TIMEOUT_SEC = 1.5;

const _roomServices = new Map<number, RoomServiceClient>();

/** Ленивый общий клиент Server API; timeoutSec — сколько ждать ответа на запрос. */
export function getRoomService(timeoutSec = LIVEKIT_REQUEST_TIMEOUT_SEC): RoomServiceClient {
  let service = _roomServices.get(timeoutSec);
  if (!service) {
    service = new RoomServiceClient(
      httpHost(),
      requireEnv("LIVEKIT_API_KEY"),
      requireEnv("LIVEKIT_API_SECRET"),
      { requestTimeout: timeoutSec },
    );
    _roomServices.set(timeoutSec, service);
  }
  return service;
}

let _webhookReceiver: WebhookReceiver | null = null;

/** Приёмник вебхуков LiveKit (проверяет подпись теми же ключами). */
export function getWebhookReceiver(): WebhookReceiver {
  if (!_webhookReceiver) {
    _webhookReceiver = new WebhookReceiver(
      requireEnv("LIVEKIT_API_KEY"),
      requireEnv("LIVEKIT_API_SECRET"),
    );
  }
  return _webhookReceiver;
}

let _tokenVerifier: TokenVerifier | null = null;

function getTokenVerifier(): TokenVerifier {
  if (!_tokenVerifier) {
    _tokenVerifier = new TokenVerifier(
      requireEnv("LIVEKIT_API_KEY"),
      requireEnv("LIVEKIT_API_SECRET"),
    );
  }
  return _tokenVerifier;
}

/** «Не найдено» от LiveKit: комнаты или участника уже нет. Обычно это не ошибка. */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof TwirpError && (err.status === 404 || err.code === "not_found");
}

// Срок токена при проверке личности не важен: jose не умеет «не проверять exp»,
// поэтому даём огромный допуск. Безопасность держится на подписи и комнате.
const EXPIRED_TOKEN_TOLERANCE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Проверяет LiveKit-токен как ДОКАЗАТЕЛЬСТВО ЛИЧНОСТИ (модерация, чат): подпись
 * нашим ключом и комната обязательны, срок — нет. Участник сидит в комнате дольше
 * 30-минутного срока токена (LiveKit держит соединение), и права хоста не должны
 * пропадать через полчаса. Вход в комнату этим не даётся: для него нужен свежий
 * токен от /api/token. Сверх подписи маршруты проверяют, что участник сейчас в
 * комнате. null — токен чужой, битый или от другой комнаты.
 */
export async function verifyParticipantToken(
  token: string,
  code: string,
): Promise<{ identity: string; name: string } | null> {
  try {
    const claims = await getTokenVerifier().verify(token, EXPIRED_TOKEN_TOLERANCE_SECONDS);
    if (!claims.sub || claims.video?.room !== code) return null;
    return { identity: claims.sub, name: typeof claims.name === "string" ? claims.name : "" };
  } catch {
    return null;
  }
}

/**
 * Короткий код комнаты, напр. "K7QMP4". Алфавит без похожих символов (нет 0/O,
 * 1/I/L) — код проще диктовать друзьям. Алфавит и длина — общие с клиентом
 * (@/lib/roomCode): поле «Код или ссылка» чистит ввод по тем же правилам.
 */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Код из запроса в каноническом виде (верхний регистр). null — заведомо не код:
 * такую строку не стоит даже нести в ключи Redis.
 */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

/** Ключ владельца — длинная случайная строка, выдаётся создателю комнаты один раз. */
export function generateHostKey(): string {
  return randomBytes(24).toString("hex");
}

/** Хэширует пароль или ключ владельца (scrypt + соль). Формат: "salt:hash" (hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Проверяет пароль против сохранённого хэша; сравнение — за постоянное время. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  // keylen = expected.length → буферы заведомо одной длины для timingSafeEqual.
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(derived, expected);
}

/**
 * Хэш секрета устройства для закрепления места (TOFU). Хватает sha256: секрет —
 * 32 случайных байта, перебирать нечего, и считается он на каждом входе.
 */
export function hashSeatSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Совпадает ли секрет с закреплённым за местом хэшем (за постоянное время). */
export function seatSecretMatches(secret: string, storedHash: string): boolean {
  const actual = Buffer.from(hashSeatSecret(secret), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Токен входа в комнату. Права — из permissionFor (полный набор), metadata — из
 * participantMetaFor. Срок короткий (30 мин): он ограничивает только сам вход;
 * дальше LiveKit продлевает сессию сам. Принуждение бана, кика и замка для тех,
 * кто подключится напрямую со старым токеном, — в вебхуке participant_joined.
 */
export async function createParticipantToken(opts: {
  room: string;
  identity: string;
  name: string;
  metadata: string;
  permission: FullParticipantPermission;
  /** Атрибуты участника с первой секунды (звук входа); нет — без атрибутов. */
  attributes?: Record<string, string>;
}): Promise<string> {
  const at = new AccessToken(requireEnv("LIVEKIT_API_KEY"), requireEnv("LIVEKIT_API_SECRET"), {
    identity: opts.identity,
    name: opts.name,
    metadata: opts.metadata,
    ...(opts.attributes ? { attributes: opts.attributes } : {}),
    ttl: "30m",
  });
  const p = opts.permission;
  at.addGrant({
    roomJoin: true,
    room: opts.room,
    canSubscribe: p.canSubscribe,
    canPublish: p.canPublish,
    canPublishData: p.canPublishData,
    canPublishSources: p.canPublishSources,
    canUpdateOwnMetadata: p.canUpdateMetadata,
  });
  return at.toJwt();
}
