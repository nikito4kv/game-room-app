// Что участнику можно прямо сейчас — для кнопок и подсказок. Решает сервер:
// он прошивает права в LiveKit (participant.permissions), а сам LiveKit не даст
// опубликовать запрещённое. Интерфейс только честно показывает это заранее.
// Подписи «почему нельзя» берём из настроек комнаты и metadata участника.
import type { ParticipantPublicMeta, RoomSettings } from "@/lib/api/contract";

/**
 * Источники в правах LiveKit — числа из TrackSource протокола (livekit-client
 * этот enum наружу не отдаёт): MICROPHONE = 2, SCREEN_SHARE = 3, SCREEN_SHARE_AUDIO = 4.
 */
export const PROTO_SOURCE = { MICROPHONE: 2, SCREEN_SHARE: 3, SCREEN_SHARE_AUDIO: 4 } as const;
export type ProtoSource = (typeof PROTO_SOURCE)[keyof typeof PROTO_SOURCE];

/** Нужная часть participant.permissions. */
export type PermissionLike = { canPublish?: boolean; canPublishSources?: readonly number[] } | undefined;

/**
 * Можно ли публиковать источник — та же проверка, что у LiveKit
 * (LocalParticipant.hasPermissionsToPublish): пустой список источников — можно всё.
 * Прав ещё нет (не подключились) — нельзя.
 */
export function canPublishSource(perms: PermissionLike, source: ProtoSource): boolean {
  if (!perms?.canPublish) return false;
  const list = perms.canPublishSources ?? [];
  return list.length === 0 || list.includes(source);
}

export type MyAbilities = {
  /** Можно включить микрофон (хост не заглушил). */
  canSpeak: boolean;
  /** Можно показывать экран (картинку). */
  canShareScreen: boolean;
  /** Можно передавать звук демонстрации (при принудительном мьюте — нет). */
  canShareScreenAudio: boolean;
  /** Почему нельзя показывать экран — подсказка к кнопке. */
  screenHint: string | null;
  /** Можно писать в чат (политика комнаты и личный запрет). */
  canChat: boolean;
  /** Почему нельзя писать — подпись у поля ввода. */
  chatHint: string | null;
};

/** Почему нельзя писать в чат; null — можно. Повторяет проверку сервера (chatRules). */
export function chatBlockReason(
  settings: RoomSettings,
  amHost: boolean,
  meta: Pick<ParticipantPublicMeta, "chatMuted">,
): string | null {
  if (settings.chat === "off") return "Хост выключил чат";
  if (amHost) return null;
  if (settings.chat === "host") return "Сейчас писать в чат может только хост";
  if (meta.chatMuted) return "Хост запретил вам писать в чат";
  return null;
}

function screenBlockReason(settings: RoomSettings): string {
  switch (settings.screen) {
    case "host":
      return "Показывать экран сейчас может только хост";
    case "approved":
      return "Показать экран можно, когда хост разрешит";
    case "all":
      return "Показ экрана сейчас недоступен";
  }
}

export function myAbilities(input: {
  permissions: PermissionLike;
  settings: RoomSettings;
  amHost: boolean;
  meta: Pick<ParticipantPublicMeta, "chatMuted">;
}): MyAbilities {
  const { permissions, settings, amHost, meta } = input;
  const canShareScreen = canPublishSource(permissions, PROTO_SOURCE.SCREEN_SHARE);
  const chatHint = chatBlockReason(settings, amHost, meta);
  return {
    canSpeak: canPublishSource(permissions, PROTO_SOURCE.MICROPHONE),
    canShareScreen,
    canShareScreenAudio: canPublishSource(permissions, PROTO_SOURCE.SCREEN_SHARE_AUDIO),
    screenHint: canShareScreen || !permissions ? null : screenBlockReason(settings),
    canChat: chatHint === null,
    chatHint,
  };
}
