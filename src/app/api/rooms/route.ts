import { NextResponse } from "next/server";
import {
  DEFAULT_ROOM_SETTINGS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  parseRoomPublicMeta,
  type CreateRoomResponse,
  type PublicRoomSummary,
} from "@/lib/api/contract";
import { cleanDisplayText } from "@/lib/api/nickname";
import { generateHostKey, generateRoomCode, getRoomService, hashPassword } from "@/lib/livekit";
import {
  NO_KEY,
  createRoomState,
  deleteRoomState,
  loadAuthMany,
  type RoomAuth,
  type StoredRoomMeta,
} from "@/lib/roomSecret";
import { MAX_PARTICIPANTS_HARD, type AccessKey } from "@/lib/api/platform";
import {
  clientIp,
  consumeLimit,
  consumeWindow,
  createRoomLimit,
  listRoomsLimit,
} from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { liveKitRoomOptions, roomCapacity, toPublicMeta } from "@/lib/server/roomSync";
import { KEY_REFUSAL_TEXT, markKeyUsed, validateKeySecret } from "@/lib/platform/accessKeys";
import { findBlock } from "@/lib/platform/blocks";
import { emitEvent } from "@/lib/platform/events";
import { loadClosedRoom } from "@/lib/platform/roomAdmin";
import {
  isFlagOn,
  loadRuntimeConfig,
  maintenanceMessage,
  newRoomsBlocked,
} from "@/lib/platform/runtimeConfig";
import { emitSignal, emitSignalOnce } from "@/lib/platform/signals";
import {
  sortPublicRooms,
  toPublicRoomSummaries,
  type PublicRoomCandidate,
} from "@/lib/publicRooms";

// POST /api/rooms — создать комнату; GET /api/rooms — витрина публичных комнат.
// Контракт — src/lib/api/contract.ts (CreateRoomRequest, PublicRoomsResponse).

const CODE_ATTEMPTS = 6;

const CLOSED_FOR_NEW_ROOMS = "Создание новых комнат временно закрыто. Попробуйте чуть позже";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  const ip = clientIp(request);

  // Решения администрации: блок адреса, режим обслуживания, аварийный флаг.
  const [block, cfg] = await Promise.all([findBlock(ip, null), loadRuntimeConfig()]);
  if (block) {
    void emitSignal("blocked_attempt", "medium", { ip, detail: "создание комнаты, адрес заблокирован" });
    return errorResponse(apiError("BLOCKED"));
  }
  if (newRoomsBlocked(cfg) || !isFlagOn(cfg, "create_room")) {
    return errorResponse(apiError("MAINTENANCE", maintenanceMessage(cfg, CLOSED_FOR_NEW_ROOMS)));
  }

  const limit = await consumeLimit(createRoomLimit(), ip);
  if (limit.limited) {
    void emitSignalOnce(ip, 600, "room_spam", "medium", { ip, detail: "лимит создания комнат с одного адреса" });
    return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));
  }

  const title = typeof body.title === "string" ? cleanDisplayText(body.title) : "";
  if (!title) return errorResponse(apiError("INVALID_TITLE", "Введите название комнаты"));
  if ([...title].length > TITLE_MAX_LENGTH) return errorResponse(apiError("INVALID_TITLE"));

  if (body.password !== undefined && body.password !== null && typeof body.password !== "string") {
    return errorResponse(apiError("BAD_REQUEST"));
  }
  const password = typeof body.password === "string" ? body.password.trim() : "";
  if (password && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
    return errorResponse(apiError("INVALID_PASSWORD"));
  }

  // Ключ клуба или код: проверяем до создания, неверный — комнату не создаём.
  let accessKey: AccessKey | null = null;
  const keyInput = optionalString(body.key);
  if (keyInput) {
    if (!isFlagOn(cfg, "access_keys")) {
      return errorResponse(
        apiError("FEATURE_DISABLED", "Ключи клубов сейчас не принимаются. Создайте комнату без ключа"),
      );
    }
    try {
      const checked = await validateKeySecret(keyInput);
      if (!checked.ok) return errorResponse(apiError("INVALID_KEY", KEY_REFUSAL_TEXT[checked.reason]));
      accessKey = checked.key;
    } catch (err) {
      console.error("rooms: key check failed", err);
      return errorResponse(failureFrom(err));
    }
  }

  try {
    // Потолки сервера из настроек продукта (0 — без ограничения).
    if (cfg.limits.maxRooms > 0 && (await getRoomService().listRooms()).length >= cfg.limits.maxRooms) {
      return errorResponse(
        apiError("MAINTENANCE", "Сейчас на сервере слишком много комнат. Попробуйте через несколько минут"),
      );
    }
    const perMinute = await consumeWindow("newRooms", cfg.limits.newRoomsPerMinute, 60);
    if (perMinute.limited) return errorResponse(retryError("RATE_LIMITED", perMinute.retryAfterSec));
  } catch (err) {
    console.error("rooms: limits check failed", err);
    return errorResponse(failureFrom(err));
  }

  // Использование ключа списываем до создания (атомарно): два создания по ключу на
  // один раз не пройдут оба. Сбой создания после списания — редкость, ключ теряет
  // одно использование.
  if (accessKey) {
    try {
      const used = await markKeyUsed(accessKey.id);
      if (!used.ok) return errorResponse(apiError("INVALID_KEY", KEY_REFUSAL_TEXT[used.reason]));
      accessKey = used.key;
    } catch (err) {
      console.error("rooms: key use failed", err);
      return errorResponse(failureFrom(err));
    }
  }

  // Хоста у новой комнаты нет: им станет тот, кто войдёт с ключом владельца.
  const hostKey = generateHostKey();
  const meta: Omit<StoredRoomMeta, "rev"> = {
    title,
    isPublic: body.isPublic === true,
    createdAt: Date.now(),
    hostIdentity: null,
    hostName: null,
    ownerIdentity: null,
    locked: false,
    hasPassword: password !== "",
    settings: DEFAULT_ROOM_SETTINGS,
    ...(accessKey
      ? {
          badge: { label: accessKey.label, color: accessKey.color },
          keyId: accessKey.id,
          maxParticipants: accessKey.maxParticipants
            ? Math.min(accessKey.maxParticipants, MAX_PARTICIPANTS_HARD)
            : null,
        }
      : NO_KEY),
  };
  const capacity = roomCapacity(meta, cfg);

  try {
    const auth: RoomAuth = {
      passwordHash: password ? await hashPassword(password) : null,
      hostKeyHash: await hashPassword(hostKey),
    };
    const service = getRoomService();
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = generateRoomCode();
      // Код свободен, только если его нет ни в LiveKit, ни в Redis (там состояние
      // закрытой комнаты ещё живёт 15 минут «на возвращение»).
      if ((await service.listRooms([code])).length > 0) continue;
      // Код недавно закрытой администрацией комнаты не выдаём: вход в него закрыт на сутки.
      if (await loadClosedRoom(code)) continue;
      const reserved = await createRoomState(code, { meta, auth });
      if (!reserved) continue;
      try {
        await service.createRoom({
          name: code,
          metadata: JSON.stringify(toPublicMeta({ ...meta, rev: 1 })),
          ...liveKitRoomOptions(capacity),
        });
      } catch (err) {
        await deleteRoomState(code).catch(() => {});
        throw err;
      }
      void emitEvent({
        t: "room_created",
        code,
        ip: ip !== "local" ? ip : undefined,
        vid: optionalString(body.vid)?.slice(0, 64),
        key: accessKey?.id,
        isPublic: meta.isPublic ? "1" : "0",
        hasPassword: meta.hasPassword ? "1" : "0",
      });
      const response: CreateRoomResponse = { code, hostKey };
      return NextResponse.json(response);
    }
    console.error("rooms: не нашлось свободного кода");
    return errorResponse(apiError("SERVER_ERROR"));
  } catch (err) {
    console.error("rooms: create failed", err);
    return errorResponse(failureFrom(err));
  }
}

// Витрина не растёт безгранично: отдаём верхушку отсортированного списка.
const MAX_PUBLIC_ROOMS = 60;
// Короткий кэш в памяти: ответ одинаков для всех, а кнопка «обновить» и опрос не
// должны дёргать LiveKit и Redis на каждый запрос.
const LIST_CACHE_TTL_MS = 5_000;
let _listCache: { at: number; rooms: PublicRoomSummary[] } | null = null;

/** no-store: общий кэш и bfcache не должны отдавать протухший список. */
function listResponse(rooms: PublicRoomSummary[]): NextResponse {
  const res = NextResponse.json({ rooms });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Публичные комнаты с живыми участниками. Описание — из зеркала в LiveKit (его
 * пишет сервер), наличие пароля и сама жизнеспособность — из Redis одним запросом.
 */
export async function GET(request: Request) {
  const limit = await consumeLimit(listRoomsLimit(), clientIp(request));
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  // Витрина выключена администрацией — пустой список без ошибки: страница покажет
  // «сейчас нет открытых комнат». Режимы «процент» и «список» — по комнатам ниже.
  const cfg = await loadRuntimeConfig();
  if (cfg.flags.public_rooms?.mode === "off") return listResponse([]);

  const now = Date.now();
  if (_listCache && now - _listCache.at < LIST_CACHE_TTL_MS) {
    return listResponse(_listCache.rooms);
  }

  try {
    const rooms = await getRoomService().listRooms();
    // «Создал, но не зашёл» и «все вышли» в витрине не показываем — некого встречать.
    const candidates: PublicRoomCandidate[] = rooms.flatMap((room) => {
      if (room.numParticipants <= 0) return [];
      const meta = parseRoomPublicMeta(room.metadata);
      if (!meta?.isPublic) return [];
      if (!isFlagOn(cfg, "public_rooms", room.name)) return [];
      // Лимит людей: у комнаты по ключу он свой (он же лимит LiveKit), у обычной —
      // не выше текущего лимита настроек продукта.
      const cap = cfg.limits.maxParticipants;
      const maxParticipants = meta.badge ? room.maxParticipants : Math.min(room.maxParticipants || cap, cap);
      return [
        {
          room: { name: room.name, numParticipants: room.numParticipants, maxParticipants },
          meta: {
            title: meta.title,
            hostName: meta.hostName ?? "",
            createdAt: meta.createdAt,
            locked: meta.locked,
            ...(meta.badge ? { badge: meta.badge } : {}),
          },
        },
      ];
    });

    // Сортируем и режем ДО чтения Redis: ключ сортировки от него не зависит.
    const top = sortPublicRooms(candidates).slice(0, MAX_PUBLIC_ROOMS);

    // Если Redis не ответил — список не роняем: «пароль неизвестен» трактуем
    // консервативно (как «есть»), но такой ответ не кэшируем.
    let authByCode: Map<string, RoomAuth | null>;
    let authOk = true;
    try {
      authByCode = await loadAuthMany(top.map(({ room }) => room.name));
    } catch (err) {
      console.error("rooms: loadAuthMany failed", err);
      authByCode = new Map();
      authOk = false;
    }

    const summaries = toPublicRoomSummaries(top, authByCode);
    if (authOk) _listCache = { at: Date.now(), rooms: summaries };
    return listResponse(summaries);
  } catch (err) {
    console.error("rooms: list failed", err);
    return errorResponse(failureFrom(err));
  }
}
