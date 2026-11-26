// Связка «Redis ↔ LiveKit». Источник правды о комнате — Redis (roomSecret.ts);
// LiveKit получает отсюда зеркало описания (room.metadata) и права участников.
// Здесь же самолечение после перезапуска LiveKit: комнату, которую он потерял,
// пересоздаём из Redis с тем же описанием.
import {
  TrackSource,
  type ParticipantInfo,
  type Room,
  type TrackInfo,
} from "livekit-server-sdk";
import {
  MAX_PARTICIPANTS,
  SYSTEM_CHAT_AUTHOR,
  CHAT_TOPIC,
  parseParticipantPublicMeta,
  parseRoomPublicMeta,
  type RemovalReason,
  type ChatMessage,
  type RoomPublicMeta,
} from "@/lib/api/contract";
import { randomBytes } from "node:crypto";
import { DataPacket_Kind } from "livekit-server-sdk";
import { MAX_PARTICIPANTS_HARD, type RuntimeConfig } from "@/lib/api/platform";
import { isFlagOn, loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { getRoomService, isNotFoundError } from "@/lib/livekit";
import {
  NO_KEY,
  appendChatMessage,
  createMetaIfMissing,
  loadAuth,
  loadMetaRev,
  loadRoomFlags,
  loadRoomMeta,
  type RoomFlags,
  type StoredRoomMeta,
} from "@/lib/roomSecret";
import {
  participantMetaFor,
  permissionFor,
  permissionWithoutScreen,
  samePermission,
  type ParticipantState,
} from "./permissions";

/**
 * Параметры комнаты в LiveKit — одни и те же при создании и при восстановлении.
 *  • emptyTimeout — сколько держать комнату, пока в неё никто не зашёл;
 *  • departureTimeout — сколько держать после ухода последнего: перезагрузка или
 *    короткий обрыв не убивают комнату.
 */
export const LIVEKIT_ROOM_OPTIONS = {
  emptyTimeout: 2 * 60,
  departureTimeout: 90,
  maxParticipants: MAX_PARTICIPANTS,
};

/**
 * Сколько людей пускать в комнату: лимит ключа клуба, а без ключа — общий лимит
 * из настроек продукта (по умолчанию MAX_PARTICIPANTS). Не выше MAX_PARTICIPANTS_HARD.
 */
export function roomCapacity(meta: Pick<StoredRoomMeta, "maxParticipants">, cfg: RuntimeConfig): number {
  const cap = meta.maxParticipants ?? cfg.limits.maxParticipants;
  return Math.min(Math.max(2, cap), MAX_PARTICIPANTS_HARD);
}

/** Параметры комнаты в LiveKit с её лимитом людей. */
export function liveKitRoomOptions(capacity: number) {
  return { ...LIVEKIT_ROOM_OPTIONS, maxParticipants: capacity };
}

/** Показ экрана выключен в этой комнате флагом screen_share. Не бросает. */
export async function screenBlockedFor(code: string): Promise<boolean> {
  return !isFlagOn(await loadRuntimeConfig(), "screen_share", code);
}

/** Публичное описание из записи в Redis. */
export function toPublicMeta(m: StoredRoomMeta): RoomPublicMeta {
  return {
    v: 2,
    title: m.title,
    isPublic: m.isPublic,
    createdAt: m.createdAt,
    hostIdentity: m.hostIdentity,
    hostName: m.hostName,
    ownerIdentity: m.ownerIdentity,
    locked: m.locked,
    hasPassword: m.hasPassword,
    settings: m.settings,
    ...(m.badge ? { badge: m.badge } : {}),
  };
}

/**
 * Описание комнаты из Redis. МИГРАЦИЯ(quality-pass): у комнат, созданных прежней
 * версией сервера (до описания в Redis), его там нет — переносим из metadata
 * LiveKit (старая схема: хост — ник). Это про данные на проде в момент выкатки, а
 * не про старый клиент. Убрать через 48 ч после выкатки: таких комнат не останется.
 */
export async function loadRoomMetaOrAdopt(
  code: string,
  liveRoom?: Room | null,
): Promise<StoredRoomMeta | null> {
  const meta = await loadRoomMeta(code);
  if (meta) return meta;
  const auth = await loadAuth(code);
  if (!auth) return null;
  const room = liveRoom === undefined ? (await getRoomService().listRooms([code]))[0] : liveRoom;
  const old = parseRoomPublicMeta(room?.metadata);
  if (!old) return null;
  await createMetaIfMissing(code, {
    title: old.title,
    isPublic: old.isPublic,
    createdAt: old.createdAt,
    hostIdentity: old.hostIdentity,
    hostName: old.hostName,
    ownerIdentity: null,
    locked: old.locked,
    hasPassword: auth.passwordHash !== null,
    settings: old.settings,
    ...NO_KEY,
  });
  return loadRoomMeta(code);
}

/**
 * Пишет описание из Redis в room.metadata. Перечитывает счётчик изменений после
 * записи: если параллельный запрос успел поменять описание, пишет ещё раз — так
 * в LiveKit не «залипает» устаревший снимок. Комнаты нет в LiveKit — не ошибка:
 * её пересоздаст следующий вход уже со свежим описанием.
 */
export async function mirrorRoomMeta(code: string): Promise<void> {
  const service = getRoomService();
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await loadRoomMeta(code);
    if (!meta) return;
    try {
      await service.updateRoomMetadata(code, JSON.stringify(toPublicMeta(meta)));
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
    if ((await loadMetaRev(code)) === meta.rev) return;
  }
}

/**
 * Гарантирует, что комната есть в LiveKit и её metadata совпадает с Redis.
 * Потерянную (перезапуск LiveKit) — создаёт заново с описанием из Redis. Если
 * metadata иная — пустая (комнату создал сам LiveKit по старому токену при
 * auto_create), старой схемы или устаревшая (параллельный вход успел создать
 * комнату раньше: повторный createRoom отдаёт существующую как есть) — пишет
 * зеркало. Токен выдаётся только после этого: при auto_create: false в
 * несуществующую комнату не войти.
 */
export async function ensureLiveKitRoom(
  code: string,
  meta: StoredRoomMeta,
  liveRoom: Room | null,
  capacity: number = meta.maxParticipants ?? MAX_PARTICIPANTS,
): Promise<void> {
  const metadata = JSON.stringify(toPublicMeta(meta));
  // Пересоздание после перезапуска LiveKit сохраняет лимит людей (в том числе ключа клуба).
  const room =
    liveRoom ??
    (await getRoomService().createRoom({ name: code, metadata, ...liveKitRoomOptions(capacity) }));
  if (room.metadata !== metadata) await mirrorRoomMeta(code);
}

/** Состояние участника для permissionFor по описанию комнаты и флагам из Redis. */
export function participantState(
  identity: string,
  meta: StoredRoomMeta,
  flags: RoomFlags,
  screenBlocked = false,
): ParticipantState {
  return {
    isHost: meta.hostIdentity === identity,
    forceMuted: flags.muted.has(identity),
    chatMuted: flags.chatMuted.has(identity),
    screenAllowed: flags.screenAllowed.has(identity),
    screenBlocked,
  };
}

type LiveParticipant = Pick<ParticipantInfo, "identity" | "metadata" | "permission">;

/**
 * Применяет к присутствующему участнику права и metadata. Если всё уже так —
 * ничего не шлёт (каждый updateParticipant рассылается всей комнате). Ушёл —
 * не ошибка.
 */
export async function applyToParticipant(
  code: string,
  participant: LiveParticipant,
  meta: StoredRoomMeta,
  state: ParticipantState,
): Promise<void> {
  const permission = permissionFor(meta.settings, state);
  const metadata = JSON.stringify(participantMetaFor(state));
  if (samePermission(participant.permission, permission) && participant.metadata === metadata) {
    return;
  }
  try {
    await getRoomService().updateParticipant(code, participant.identity, { metadata, permission });
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}

/**
 * Пересчитывает права присутствующих после смены настроек или флагов. only —
 * ограничить перечисленными identity (например, старый и новый хост).
 */
export async function syncParticipants(code: string, only?: readonly string[]): Promise<void> {
  const [participants, state, screenBlocked] = await Promise.all([
    listParticipantsOrEmpty(code),
    loadRoomFlags(code),
    screenBlockedFor(code),
  ]);
  const { meta, flags } = state;
  if (!meta) return;
  const targets = only ? participants.filter((p) => only.includes(p.identity)) : participants;
  await Promise.all(
    targets.map((p) =>
      applyToParticipant(code, p, meta, participantState(p.identity, meta, flags, screenBlocked)),
    ),
  );
}

/** Участник, если он сейчас в комнате; иначе null. */
export async function getParticipantOrNull(
  code: string,
  identity: string,
): Promise<ParticipantInfo | null> {
  try {
    return await getRoomService().getParticipant(code, identity);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** Участники комнаты; комнаты нет в LiveKit — пустой список. */
export async function listParticipantsOrEmpty(code: string): Promise<ParticipantInfo[]> {
  try {
    return await getRoomService().listParticipants(code);
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
}

/**
 * Удаляет участника и сначала пишет причину в его metadata: клиент увидит
 * removed до отключения (оба сообщения идут по одному сигнальному каналу по
 * порядку) и покажет «вас кикнули на 5 минут», а не просто «вас удалили».
 */
export async function removeWithReason(
  code: string,
  participant: Pick<ParticipantInfo, "identity" | "metadata">,
  reason: RemovalReason,
  retryAfterSec?: number,
): Promise<void> {
  const service = getRoomService();
  const metadata = JSON.stringify({
    ...parseParticipantPublicMeta(participant.metadata),
    removed: retryAfterSec === undefined ? { reason } : { reason, retryAfterSec },
  });
  // Причина — удобство для интерфейса, удаление — главное: сбой первой записи не
  // должен оставить нарушителя в комнате.
  await service
    .updateParticipant(code, participant.identity, { metadata })
    .catch((err: unknown) => {
      if (!isNotFoundError(err)) console.error("removal reason update failed", err);
    });
  try {
    await service.removeParticipant(code, participant.identity);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}

/**
 * «Заглушить всех» — мягко: выключает опубликованные микрофоны через
 * mutePublishedTrack. Каждый может включить свой микрофон обратно сам.
 *
 * Шлём и уже заглушённым трекам (рация в ожидании, «звук выкл»): клиент получает
 * сигнал «заглушили снаружи» и выключает микрофон по-настоящему. Без этого такой
 * человек снова оказался бы в эфире, отпустив рацию или сняв «звук выкл».
 */
export async function softMuteAll(code: string, except: ReadonlySet<string>): Promise<void> {
  const service = getRoomService();
  const participants = await listParticipantsOrEmpty(code);
  const jobs: Promise<unknown>[] = [];
  for (const p of participants) {
    if (except.has(p.identity)) continue;
    for (const t of p.tracks) {
      if (t.source === TrackSource.MICROPHONE) {
        jobs.push(service.mutePublishedTrack(code, p.identity, t.sid, true));
      }
    }
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected" && !isNotFoundError(r.reason)) throw r.reason;
  }
}

const isScreenTrack = (t: TrackInfo) =>
  t.source === TrackSource.SCREEN_SHARE || t.source === TrackSource.SCREEN_SHARE_AUDIO;

const SCREEN_STOP_POLL_MS = 150;
const SCREEN_STOP_POLLS = 10;

/**
 * Останавливает чужую демонстрацию. Серверного «снять трек» у LiveKit нет, но при
 * отзыве права на источник он снимает трек сам, а клиент останавливает захват.
 * Поэтому: забираем право на экран → ждём, пока трек исчезнет (обычно сразу) →
 * возвращаем права как были. Показать экран снова участник сможет сам.
 */
export async function stopScreenShare(
  code: string,
  participant: Pick<ParticipantInfo, "identity" | "tracks">,
  meta: StoredRoomMeta,
  state: ParticipantState,
): Promise<void> {
  if (!participant.tracks.some(isScreenTrack)) return;
  const service = getRoomService();
  const identity = participant.identity;
  try {
    await service.updateParticipant(code, identity, {
      permission: permissionWithoutScreen(meta.settings, state),
    });
    for (let i = 0; i < SCREEN_STOP_POLLS; i++) {
      const fresh = await service.getParticipant(code, identity);
      if (!fresh.tracks.some(isScreenTrack)) break;
      await new Promise((resolve) => setTimeout(resolve, SCREEN_STOP_POLL_MS));
    }
    await service.updateParticipant(code, identity, {
      permission: permissionFor(meta.settings, state),
    });
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}

/**
 * Системное сообщение администрации в чат комнаты: тот же путь, что у обычного
 * сообщения (data-пакет CHAT_TOPIC всем + история), автор — SYSTEM_CHAT_AUTHOR,
 * признак system: true. Комнаты нет в LiveKit — сообщение только в историю.
 */
export async function sendSystemChatMessage(code: string, text: string): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: randomBytes(12).toString("base64url"),
    ts: Date.now(),
    from: { ...SYSTEM_CHAT_AUTHOR },
    text,
    system: true,
  };
  try {
    await getRoomService().sendData(
      code,
      new TextEncoder().encode(JSON.stringify(message)),
      DataPacket_Kind.RELIABLE,
      { topic: CHAT_TOPIC },
    );
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
  await appendChatMessage(code, message);
  return message;
}
