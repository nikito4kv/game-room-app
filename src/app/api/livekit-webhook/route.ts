import { TrackSource, type ParticipantInfo, type Room, type WebhookEvent } from "livekit-server-sdk";
import { parseRoomPublicMeta } from "@/lib/api/contract";
import { getWebhookReceiver } from "@/lib/livekit";
import {
  clearHostLeft,
  expireRoomStateSoon,
  loadEntryBlocks,
  loadRoomFlags,
  loadRoomMeta,
  markHostLeft,
  rememberName,
  setParticipantFlag,
  touchRoomState,
} from "@/lib/roomSecret";
import { cleanupStats, readStats, recordJoin } from "@/lib/analytics/roomStats";
import { captureRoomSession } from "@/lib/analytics/posthogServer";
import { claimWebhookEvent } from "@/lib/server/webhookDedup";
import {
  applyToParticipant,
  getParticipantOrNull,
  listParticipantsOrEmpty,
  loadRoomMetaOrAdopt,
  mirrorRoomMeta,
  participantState,
  removeWithReason,
  screenBlockedFor,
  stopScreenShare,
} from "@/lib/server/roomSync";
import { emitEvent } from "@/lib/platform/events";
import {
  countScreenShares,
  loadAdminEntryBlock,
  loadClosedRoom,
  participantStateFor,
} from "@/lib/platform/roomAdmin";
import { loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { emitFeatureOnce } from "@/lib/platform/signals";

// Вебхук LiveKit. Адрес задаётся в livekit.yaml (секция webhook). Что делает:
//  • любое событие комнаты продлевает срок жизни её состояния в Redis (48 ч);
//  • room_started — если LiveKit создал комнату без описания (старый токен после
//    перезапуска при auto_create), заполняет metadata из Redis;
//  • participant_joined — РЕАЛЬНОЕ принуждение бана, кика и замка: /api/token
//    можно обойти, подключившись напрямую с ещё живым токеном, а здесь участник
//    ловится уже на входе. Плюс права по permissionFor и «был в комнате» (замок);
//  • participant_left — если ушёл хост, отметка времени: с неё считается пауза
//    перед тем, как его место сможет занять другой;
//  • room_finished — аналитика и короткий срок жизни состояния (15 мин «на
//    возвращение», см. roomSecret.ts) вместо немедленного удаления.
// Ответ всегда 200 (кроме неверной подписи): иначе LiveKit повторял бы событие.

export async function POST(request: Request) {
  const body = await request.text();
  const authHeader = request.headers.get("Authorization") ?? undefined;

  let event: WebhookEvent;
  try {
    // receive проверяет подпись нашими ключами — чужой запрос не пройдёт.
    event = await getWebhookReceiver().receive(body, authHeader);
  } catch (err) {
    console.error("webhook auth failed", err);
    return new Response("invalid signature", { status: 401 });
  }

  const code = event.room?.name;
  if (!code || !(await claimWebhookEvent(event.id))) return new Response("ok");

  try {
    switch (event.event) {
      case "room_started":
        if (event.room) await onRoomStarted(code, event.room);
        break;
      case "participant_joined":
        if (event.participant?.identity) await onParticipantJoined(code, event, event.participant);
        break;
      case "participant_left":
        if (event.participant?.identity) await onParticipantLeft(code, event, event.participant);
        break;
      case "room_finished":
        await onRoomFinished(code, event);
        break;
      case "track_published":
        if (event.participant?.identity) await onTrackPublished(code, event, event.participant);
        break;
    }
    if (event.event !== "room_finished") await touchRoomState(code);
  } catch (err) {
    // Не валим вебхук — иначе LiveKit будет повторять событие.
    console.error(`webhook ${event.event} failed`, err);
  }
  return new Response("ok");
}

/** Пустая или битая metadata у нашей комнаты — заполнить из Redis. */
async function onRoomStarted(code: string, room: Room): Promise<void> {
  if (parseRoomPublicMeta(room.metadata)) return;
  if (await loadRoomMeta(code)) await mirrorRoomMeta(code);
}

async function onParticipantJoined(
  code: string,
  event: WebhookEvent,
  participant: ParticipantInfo,
): Promise<void> {
  const identity = participant.identity;
  // Аналитика — параллельно с принуждением и без ожидания перед ним: статистика не
  // должна задерживать кик нарушителя. Ошибку проглатываем (не критично).
  const stats = recordJoin(
    code,
    identity,
    event.room?.numParticipants ?? 0,
    parseRoomPublicMeta(event.room?.metadata)?.isPublic ?? false,
  ).catch((err) => console.error("recordJoin failed", err));
  try {
    const [meta, blocks] = await Promise.all([
      loadRoomMetaOrAdopt(code, event.room ?? null),
      loadEntryBlocks(code, identity),
    ]);
    if (!meta) return; // не наша комната (или её состояние уже истекло)

    const isOwner = meta.ownerIdentity === identity;
    const isHost = meta.hostIdentity === identity;
    // Решения администрации — и для владельца (как в /api/token).
    const [closed, adminBlock] = await Promise.all([
      loadClosedRoom(code).catch(() => null),
      loadAdminEntryBlock(code, identity),
    ]);
    if (closed) return await removeWithReason(code, participant, "admin_close");
    if (adminBlock?.banned) return await removeWithReason(code, participant, "admin_ban");
    if (adminBlock && adminBlock.retryAfterSec > 0) {
      return await removeWithReason(code, participant, "admin_kick", adminBlock.retryAfterSec);
    }
    if (!isOwner) {
      if (blocks.banned) return await removeWithReason(code, participant, "ban");
      if (blocks.kickRemainingSec > 0) {
        return await removeWithReason(code, participant, "kick", blocks.kickRemainingSec);
      }
      if (meta.locked && !isHost && !blocks.member) {
        return await removeWithReason(code, participant, "locked");
      }
    }

    // Реально зашёл → «свой» для замка (а не тот, кто лишь получил токен).
    await Promise.all([
      setParticipantFlag(code, "members", identity, true),
      rememberName(code, identity, participant.name || identity),
      isHost ? clearHostLeft(code) : Promise.resolve(),
    ]);
    // Права — всегда по свежему состоянию: между выдачей токена и входом хост мог
    // заглушить участника или сменить режим экрана.
    const [{ meta: fresh, flags }, screenBlocked] = await Promise.all([
      loadRoomFlags(code),
      screenBlockedFor(code),
    ]);
    const current = fresh ?? meta;
    await applyToParticipant(
      code,
      participant,
      current,
      participantState(identity, current, flags, screenBlocked),
    );
  } finally {
    // Дожидаемся записи статистики до ответа: после ответа процесс может «уснуть».
    await stats;
  }
}

async function onParticipantLeft(
  code: string,
  event: WebhookEvent,
  participant: ParticipantInfo,
): Promise<void> {
  // Событие ухода для аналитики: сколько человек пробыл в комнате.
  const joinedSec = Number(participant.joinedAt ?? 0);
  const leftSec = Number(event.createdAt ?? 0) || Math.floor(Date.now() / 1000);
  void emitEvent({
    t: "leave",
    code,
    identity: participant.identity,
    durSec: joinedSec > 0 && leftSec >= joinedSec ? String(leftSec - joinedSec) : undefined,
  });
  const meta = await loadRoomMeta(code);
  if (!meta || meta.hostIdentity !== participant.identity) return;
  // Хост мог уже вернуться другим подключением (вторая вкладка выбила первую,
  // быстрая перезагрузка) — тогда отсчёт паузы не начинаем.
  const participants = await listParticipantsOrEmpty(code);
  if (participants.some((p) => p.identity === participant.identity)) return;
  const leftAtMs = Number(event.createdAt) * 1000;
  const now = Date.now();
  await markHostLeft(code, leftAtMs > 0 && leftAtMs <= now ? leftAtMs : now);
}

async function onRoomFinished(code: string, event: WebhookEvent): Promise<void> {
  try {
    await expireRoomStateSoon(code);
  } catch (err) {
    console.error("room state expiry failed", err);
  }
  // Аналитика: снимаем накопленную статистику и шлём room_session. Длительность —
  // из самого события (комнаты в LiveKit уже нет), публичность — из payload, а без
  // metadata — из значения, сохранённого при входах. Ключи стираем только после
  // успешной отправки: room_finished приходит один раз. Пустые комнаты не шлём.
  try {
    const stats = await readStats(code);
    const finishedAt = Number(event.createdAt ?? 0);
    const startedAt = Number(event.room?.creationTime ?? 0);
    const durationSec = startedAt > 0 && finishedAt >= startedAt ? finishedAt - startedAt : 0;
    void emitEvent({
      t: "room_finished",
      code,
      peak: String(stats.peak),
      unique: String(stats.totalUnique),
      durSec: durationSec > 0 ? String(durationSec) : undefined,
    });
    if (stats.totalUnique >= 1) {
      const isPublic = parseRoomPublicMeta(event.room?.metadata)?.isPublic ?? stats.isPublic;
      await captureRoomSession({
        code,
        peak: stats.peak,
        totalUnique: stats.totalUnique,
        durationSec,
        isPublic,
      });
    }
    await cleanupStats(code);
  } catch (err) {
    // Ключи не стираем — они истекут по сроку, данные не теряются.
    console.error("room_session analytics failed", err);
  }
}

/**
 * Показ экрана начался: событие feature screen_share и потолок одновременных
 * показов на сервер (настройки продукта). Сверх потолка показ останавливается тем
 * же способом, что «остановить показ» у хоста: право на экран отзывается на миг.
 */
async function onTrackPublished(code: string, event: WebhookEvent, participant: ParticipantInfo): Promise<void> {
  if (event.track?.source !== TrackSource.SCREEN_SHARE) return;
  void emitFeatureOnce("screen_share", code, participant.identity);
  const cfg = await loadRuntimeConfig();
  const max = cfg.limits.maxScreenShares;
  if (max <= 0) return;
  if ((await countScreenShares()) <= max) return;
  const ctx = await participantStateFor(code, participant.identity);
  if (!ctx) return;
  const live = await getParticipantOrNull(code, participant.identity);
  if (live) await stopScreenShare(code, live, ctx.meta, ctx.state);
}
