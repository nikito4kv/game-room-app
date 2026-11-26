// Единая функция прав участника. Права считаются ТОЛЬКО здесь и применяются в
// четырёх местах: при выдаче токена, в вебхуке participant_joined, после любой
// смены настроек или флагов участника (updateParticipant всем, у кого изменилось)
// и при передаче прав хоста. Так наборы прав не разъезжаются между путями.
//
// Две ловушки LiveKit (protocol auth/grants.go, сервер v1.13.7):
//  1. Пустой canPublishSources значит «можно публиковать ВСЁ». Поэтому, если по
//     расчёту не разрешён ни один источник, ставим canPublish: false.
//  2. updateParticipant копирует ВСЕ поля прав, пропущенные становятся false.
//     Поэтому функция всегда возвращает полный набор полей.
// Отзыв права на источник LiveKit исполняет сам: снимает уже опубликованный трек
// (участник перестаёт говорить или показывать экран), а клиент без права не
// сможет опубликовать его заново.
import { TrackSource } from "livekit-server-sdk";
import type {
  ParticipantPublicMeta,
  RoomSettings,
  ScreenPolicy,
} from "@/lib/api/contract";

/** Всё, от чего зависят права участника. */
export type ParticipantState = {
  isHost: boolean;
  /** Принудительный мьют от хоста. */
  forceMuted: boolean;
  /** Хост запретил писать в чат (принуждается в POST /api/chat, тут — для metadata). */
  chatMuted: boolean;
  /** Разрешение показывать экран в режиме "approved". */
  screenAllowed: boolean;
  /**
   * Показ экрана выключен администрацией (флаг screen_share) — для всех, включая
   * хоста. Не задано — не выключен.
   */
  screenBlocked?: boolean;
};

/** Полный набор полей ParticipantPermission (см. ловушку №2). */
export type FullParticipantPermission = {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: TrackSource[];
  canUpdateMetadata: boolean;
  canSubscribeMetrics: boolean;
  canManageAgentSession: boolean;
  hidden: boolean;
  recorder: boolean;
  agent: boolean;
};

const SCREEN_SOURCES: ReadonlySet<TrackSource> = new Set([
  TrackSource.SCREEN_SHARE,
  TrackSource.SCREEN_SHARE_AUDIO,
]);

/** Может ли участник показывать экран при данной политике комнаты. Хост — всегда. */
export function canShareScreen(policy: ScreenPolicy, state: ParticipantState): boolean {
  if (state.screenBlocked) return false;
  if (state.isHost) return true;
  switch (policy) {
    case "all":
      return true;
    case "host":
      return false;
    case "approved":
      return state.screenAllowed;
  }
}

/**
 * Разрешённые источники. Камеры нет: в интерфейсе её нет, а изменённый клиент не
 * должен публиковать то, чего не ждут остальные. Принудительный мьют закрывает и
 * микрофон, и звук демонстрации — иначе «говорить» можно было бы через экран.
 * Хоста не мьютят (он может снять мьют сам себе — значит, мьют бессмыслен).
 */
function allowedSources(settings: RoomSettings, state: ParticipantState): TrackSource[] {
  const muted = state.forceMuted && !state.isHost;
  const sources: TrackSource[] = [];
  if (!muted) sources.push(TrackSource.MICROPHONE);
  if (canShareScreen(settings.screen, state)) {
    sources.push(TrackSource.SCREEN_SHARE);
    if (!muted) sources.push(TrackSource.SCREEN_SHARE_AUDIO);
  }
  return sources;
}

function permissionWithSources(sources: TrackSource[]): FullParticipantPermission {
  return {
    canSubscribe: true,
    // Ловушка №1: ни одного источника → публикация выключена целиком.
    canPublish: sources.length > 0,
    canPublishSources: sources,
    // Чат идёт через сервер (POST /api/chat), своих data-пакетов клиент не шлёт
    // вовсе: так их нельзя подделать или заспамить в обход сервера.
    canPublishData: false,
    canUpdateMetadata: false,
    canSubscribeMetrics: false,
    canManageAgentSession: false,
    hidden: false,
    recorder: false,
    agent: false,
  };
}

/** Полные права участника LiveKit по настройкам комнаты и его состоянию. */
export function permissionFor(
  settings: RoomSettings,
  state: ParticipantState,
): FullParticipantPermission {
  return permissionWithSources(allowedSources(settings, state));
}

/**
 * Те же права, но без демонстрации. Нужны на мгновение, чтобы LiveKit снял идущую
 * демонстрацию («остановить чужой экран»): потом права возвращаются обратно.
 */
export function permissionWithoutScreen(
  settings: RoomSettings,
  state: ParticipantState,
): FullParticipantPermission {
  const sources = allowedSources(settings, state).filter((s) => !SCREEN_SOURCES.has(s));
  return permissionWithSources(sources);
}

/** metadata участника для интерфейса. Хост не бывает заглушён или без чата. */
export function participantMetaFor(state: ParticipantState): ParticipantPublicMeta {
  return {
    forceMuted: state.forceMuted && !state.isHost,
    chatMuted: state.chatMuted && !state.isHost,
    screenAllowed: state.screenAllowed,
  };
}

/** Права в форме, в которой их отдаёт LiveKit (ParticipantInfo.permission). */
export type PermissionLike = {
  canSubscribe?: boolean;
  canPublish?: boolean;
  canPublishData?: boolean;
  canPublishSources?: TrackSource[];
  canUpdateMetadata?: boolean;
  hidden?: boolean;
};

/**
 * Совпадают ли текущие права с нужными — чтобы не дёргать updateParticipant зря
 * (каждый вызов рассылает обновление всем участникам комнаты).
 */
export function samePermission(
  current: PermissionLike | undefined,
  next: FullParticipantPermission,
): boolean {
  if (!current) return false;
  const a = [...(current.canPublishSources ?? [])].sort();
  const b = [...next.canPublishSources].sort();
  return (
    !!current.canSubscribe === next.canSubscribe &&
    !!current.canPublish === next.canPublish &&
    !!current.canPublishData === next.canPublishData &&
    !!current.canUpdateMetadata === next.canUpdateMetadata &&
    !!current.hidden === next.hidden &&
    a.length === b.length &&
    a.every((s, i) => s === b[i])
  );
}
