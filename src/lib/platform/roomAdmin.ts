// ВАЖНО: только сервер. Действия администрации над комнатами (А2) и «живая
// картина» для админки (А1).
//
//   gr:closed:<CODE>             STRING JSON ClosedRoom, сутки: вход в код отклоняется
//   gr:akick:<CODE>:<identity>   STRING JSON {reason, until}, TTL — запрет входа от
//                                администрации (выгнать на время / навсегда в комнате)
//
// Запреты администрации лежат отдельно от кика и бана хоста: владелец комнаты
// проходит мимо решений хоста, но не мимо решений администрации.
import { TrackSource, type ParticipantInfo } from "livekit-server-sdk";
import { parseVoiceAttributes } from "@/lib/api/contract";
import type {
  AdminReason,
  ClosedRoom,
  LiveParticipant,
  LiveResponse,
  LiveRoom,
} from "@/lib/api/platform";
import { getRoomService, isNotFoundError } from "@/lib/livekit";
import { getRedisRaw } from "@/lib/redis";
import { avatarIdOfParticipant } from "@/lib/server/avatar";
import {
  deleteRoomState,
  loadRoomFlags,
  loadRoomMeta,
  setParticipantFlag,
  type StoredRoomMeta,
} from "@/lib/roomSecret";
import {
  listParticipantsOrEmpty,
  participantState,
  removeWithReason,
  screenBlockedFor,
  sendSystemChatMessage,
  syncParticipants,
} from "@/lib/server/roomSync";

export const CLOSED_TTL_SEC = 24 * 60 * 60;
/** «Навсегда в этой комнате» = дольше, чем комната может прожить без активности. */
export const ADMIN_BAN_TTL_SEC = 7 * 24 * 60 * 60;
/** Выгнать на время — не дольше недели (дальше — бан или блок устройства). */
export const ADMIN_KICK_MINUTES_MAX = 7 * 24 * 60;

const closedKey = (code: string) => `gr:closed:${code}`;
const akickKey = (code: string, identity: string) => `gr:akick:${code}:${identity}`;

// ── Закрытые комнаты ─────────────────────────────────────────────────────────

export async function loadClosedRoom(code: string): Promise<ClosedRoom | null> {
  const raw = await getRedisRaw().get(closedKey(code));
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as ClosedRoom;
  } catch {
    return null;
  }
}

/**
 * Закрыть комнату: отметка gr:closed на сутки, сообщение в чат (если есть),
 * каждому — причина admin_close и отключение, затем удаление комнаты в LiveKit
 * и её состояния в Redis. Возвращает, сколько человек было отключено.
 */
export async function closeRoom(
  code: string,
  input: { reason: AdminReason; message: string },
  now: Date = new Date(),
): Promise<number> {
  const closed: ClosedRoom = { reason: input.reason, message: input.message, at: now.toISOString() };
  // Отметка — первой: пока идёт отключение, новые входы уже отклоняются.
  await getRedisRaw().set(closedKey(code), JSON.stringify(closed), { ex: CLOSED_TTL_SEC });
  if (input.message) {
    await sendSystemChatMessage(code, input.message).catch((err: unknown) =>
      console.error("close: system message failed", err),
    );
  }
  const participants = await listParticipantsOrEmpty(code);
  await Promise.all(participants.map((p) => removeWithReason(code, p, "admin_close")));
  try {
    await getRoomService().deleteRoom(code);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
  // Статистику (пик, уникальные) не трогаем: её снимет вебхук room_finished.
  await deleteRoomState(code);
  return participants.length;
}

// ── Выгнать / забанить от администрации ──────────────────────────────────────

export type AdminEntryBlock = { banned: boolean; retryAfterSec: number };

/** Действующий запрет входа от администрации; null — нет. Не бросает (fail-open). */
export async function loadAdminEntryBlock(code: string, identity: string): Promise<AdminEntryBlock | null> {
  try {
    const p = getRedisRaw().pipeline();
    p.get(akickKey(code, identity));
    p.pttl(akickKey(code, identity));
    const [raw, ttl] = (await p.exec()) as unknown[];
    if (typeof raw !== "string") return null;
    const banned = (() => {
      try {
        return (JSON.parse(raw) as { banned?: boolean }).banned === true;
      } catch {
        return false;
      }
    })();
    const ms = Number(ttl);
    return { banned, retryAfterSec: ms > 0 ? Math.ceil(ms / 1000) : 0 };
  } catch (err) {
    console.error("admin entry block check failed", err);
    return null;
  }
}

/**
 * Выгнать участника (minutes) или забанить в комнате (minutes null). Присутствующий
 * отключается с причиной admin_kick / admin_ban. Возвращает, был ли он в комнате.
 */
export async function adminKick(
  code: string,
  identity: string,
  minutes: number | null,
  reason: AdminReason,
): Promise<boolean> {
  const banned = minutes === null;
  const ttl = banned ? ADMIN_BAN_TTL_SEC : minutes * 60;
  await Promise.all([
    getRedisRaw().set(akickKey(code, identity), JSON.stringify({ banned, reason }), { ex: ttl }),
    // Не «свой» больше: иначе вернулся бы и в запертую комнату.
    setParticipantFlag(code, "members", identity, false).catch(() => {}),
  ]);
  const live = (await listParticipantsOrEmpty(code)).find((p) => p.identity === identity);
  if (!live) return false;
  if (banned) await removeWithReason(code, live, "admin_ban");
  else await removeWithReason(code, live, "admin_kick", ttl);
  return true;
}

/** Принудительный мьют от администрации — тот же флаг, что у хоста. */
export async function adminMute(code: string, identity: string): Promise<void> {
  await setParticipantFlag(code, "muted", identity, true);
  await syncParticipants(code, [identity]);
}

// ── Живая картина ────────────────────────────────────────────────────────────

const isScreen = (source: TrackSource) =>
  source === TrackSource.SCREEN_SHARE;

/** joinedAt участника в мс (LiveKit отдаёт секунды, новые версии — ещё и мс). */
function joinedAtMs(p: ParticipantInfo): number {
  const ms = Number((p as { joinedAtMs?: bigint | number }).joinedAtMs ?? 0);
  return ms > 0 ? ms : Number(p.joinedAt ?? 0) * 1000;
}

/** Голос из атрибутов: SDK переводит ключи в camelCase (voice.ptt → voicePtt). */
function voiceOf(p: ParticipantInfo): { deafened: boolean; ptt: boolean } {
  const a = p.attributes ?? {};
  const direct = parseVoiceAttributes(a);
  return {
    deafened: direct.deafened || a.voiceDeafened === "1",
    ptt: direct.ptt || a.voicePtt === "1",
  };
}

export function toLiveParticipant(p: ParticipantInfo, meta: StoredRoomMeta | null): LiveParticipant {
  const voice = voiceOf(p);
  return {
    identity: p.identity,
    name: p.name || p.identity,
    joinedAt: joinedAtMs(p),
    isHost: !!meta && meta.hostIdentity === p.identity,
    isOwner: !!meta && meta.ownerIdentity === p.identity,
    micOn: p.tracks.some((t) => t.source === TrackSource.MICROPHONE && !t.muted),
    screenSharing: p.tracks.some((t) => isScreen(t.source)),
    deafened: voice.deafened,
    ptt: voice.ptt,
    avatarId: avatarIdOfParticipant(p),
  };
}

export function toLiveRoom(
  code: string,
  room: { maxParticipants: number; creationTime?: bigint | number } | null,
  participants: ParticipantInfo[],
  meta: StoredRoomMeta | null,
): LiveRoom {
  const people = participants.map((p) => toLiveParticipant(p, meta));
  const screenShares = people.filter((p) => p.screenSharing).length;
  const n = people.length;
  return {
    code,
    title: meta?.title ?? code,
    isPublic: meta?.isPublic ?? false,
    locked: meta?.locked ?? false,
    hasPassword: meta?.hasPassword ?? false,
    createdAt: meta?.createdAt ?? Number(room?.creationTime ?? 0) * 1000,
    numParticipants: n,
    maxParticipants: room?.maxParticipants ?? 0,
    badge: meta?.badge ?? null,
    keyId: meta?.keyId ?? null,
    participants: people,
    screenShares,
    screenViewers: screenShares * Math.max(0, n - 1),
  };
}

/** Все живые комнаты LiveKit с участниками и описанием из Redis. */
export async function liveSnapshot(now: Date = new Date()): Promise<LiveResponse> {
  const rooms = await getRoomService().listRooms();
  const live = await Promise.all(
    rooms.map(async (room) => {
      const [participants, meta] = await Promise.all([
        listParticipantsOrEmpty(room.name),
        loadRoomMeta(room.name).catch(() => null),
      ]);
      return toLiveRoom(room.name, room, participants, meta);
    }),
  );
  live.sort((a, b) => b.numParticipants - a.numParticipants || b.createdAt - a.createdAt);
  return {
    at: now.toISOString(),
    rooms: live,
    totals: {
      rooms: live.length,
      participants: live.reduce((s, r) => s + r.numParticipants, 0),
      screenShares: live.reduce((s, r) => s + r.screenShares, 0),
      screenViewers: live.reduce((s, r) => s + r.screenViewers, 0),
    },
  };
}

/** Одна комната для карточки админки; null — её нет в LiveKit. */
export async function liveRoom(code: string): Promise<LiveRoom | null> {
  const rooms = await getRoomService().listRooms([code]);
  const room = rooms[0];
  if (!room) return null;
  const [participants, meta] = await Promise.all([listParticipantsOrEmpty(code), loadRoomMeta(code)]);
  return toLiveRoom(code, room, participants, meta);
}

/**
 * Сколько показов экрана идёт сейчас на всём сервере. Для лимита maxScreenShares
 * (вебхук track_published) — обходит все комнаты, поэтому зовётся только при
 * включённом лимите.
 */
export async function countScreenShares(): Promise<number> {
  const rooms = await getRoomService().listRooms();
  const counts = await Promise.all(
    rooms.map(async (r) =>
      (await listParticipantsOrEmpty(r.name)).filter((p) => p.tracks.some((t) => isScreen(t.source))).length,
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Состояние участника для прав (с учётом флага screen_share) — для принуждения лимитов. */
export async function participantStateFor(code: string, identity: string) {
  const [{ meta, flags }, screenBlocked] = await Promise.all([loadRoomFlags(code), screenBlockedFor(code)]);
  return meta ? { meta, state: participantState(identity, meta, flags, screenBlocked) } : null;
}
