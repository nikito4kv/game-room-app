"use client";

import { memo, useCallback, useSyncExternalStore, type ReactNode } from "react";
import { useConnectionQualityIndicator } from "@livekit/components-react";
import {
  ConnectionQuality as LiveKitQuality,
  ParticipantEvent,
  type Participant,
  type ParticipantEventCallbacks,
} from "livekit-client";
import {
  Avatar,
  Badge,
  Icon,
  Rumik,
  SignalBars,
  Tooltip,
  cn,
  type AvatarSize,
  type AvatarStatus,
  type AvatarSurface,
  type ConnectionQuality,
  type IconName,
} from "@/components/ui";
import { RumikAvatar } from "@/components/ui/Avatar";
import { Glyph } from "@/components/ui/Glyph";
import {
  SEAT_FRAME_CLASS,
  SEAT_HEAD_STYLE,
  SeatLabel,
  SeatStatusBadge,
  SpeakingBadge,
} from "@/components/ui/TablePreview";
import { isPoorLink } from "@/lib/room/ping";
import type { PublicStatus } from "@/lib/api/contract";
import { nameBudget, remoteSeatVoice, seatLabel, seatStatus, shortName } from "@/lib/room/seat";
import { useDeafen } from "../audio/useDeafen";
import { useMic } from "../audio/useMic";
import { useAudioLevel, useIsSpeaking } from "../audio/useSpeaking";
import { useVoiceAttributes } from "../audio/useVoicePresence";
import { useAvatarPaint } from "../avatar/useAvatarPaint";
import { ReactionBubble } from "../reactions/ReactionBubble";
import { useReactionGesture } from "../reactions/useReactionGesture";
import { useRoomLink } from "../state/RoomSession";
import { useStatusAttributes } from "../status/useStatus";
import { STATUS_VIEW, statusWords } from "../status/view";
import { useRoomConfig } from "../state/useRoomConfig";
import { useForceMuted } from "../state/useRoomMeta";

// Место участника: Румик (или кружок-аватар при выключенном флаге rumik_table),
// имя, значки. Каждое место само подписано на события своего участника (голос,
// мьют, связь, показ экрана), поэтому разговор перерисовывает только места
// говорящих, а уровень голоса — только их кружки (аудит F-М6).

const MIC_EVENTS = [
  ParticipantEvent.TrackMuted,
  ParticipantEvent.TrackUnmuted,
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
] as const;

const SCREEN_EVENTS = [
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
] as const;

/**
 * Значение участника, которое меняется по его событиям. read должен отдавать
 * примитив — иначе useSyncExternalStore увидит «новое» значение на каждый рендер.
 */
function useParticipantValue<T extends boolean | number | string>(
  p: Participant,
  events: readonly (keyof ParticipantEventCallbacks)[],
  read: (p: Participant) => T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      for (const e of events) p.on(e, onChange);
      return () => {
        for (const e of events) p.off(e, onChange);
      };
    },
    [p, events],
  );
  return useSyncExternalStore(subscribe, () => read(p), () => read(p));
}

const readMicOff = (p: Participant) => !p.isMicrophoneEnabled;
const readStreaming = (p: Participant) => p.isScreenShareEnabled;

/** Микрофон выключен или не опубликован (нет доступа, хост заглушил). */
export function useMicOff(p: Participant): boolean {
  return useParticipantValue(p, MIC_EVENTS, readMicOff);
}

/** Участник показывает экран. */
export function useIsStreaming(p: Participant): boolean {
  return useParticipantValue(p, SCREEN_EVENTS, readStreaming);
}

const QUALITY: Record<LiveKitQuality, ConnectionQuality> = {
  [LiveKitQuality.Excellent]: "excellent",
  [LiveKitQuality.Good]: "good",
  [LiveKitQuality.Poor]: "poor",
  [LiveKitQuality.Lost]: "lost",
  [LiveKitQuality.Unknown]: "unknown",
};

/** Качество связи участника с сервером (оценка LiveKit). */
export function useLinkQuality(p: Participant): ConnectionQuality {
  return QUALITY[useConnectionQualityIndicator({ participant: p }).quality];
}

/**
 * Румики вместо кружков (флаг rumik_table для этой комнаты): за столом — во
 * весь рост, в строках, ленте под сценой и мини-комнате — головой.
 */
export function useRumikTable(): boolean {
  return useRoomConfig().flags.rumik_table;
}

type LiveAvatarProps = {
  p: Participant;
  name: string;
  colorIndex: number;
  size: AvatarSize;
  speaking: boolean;
  status: AvatarStatus | null;
  surface?: AvatarSurface;
};

/**
 * Маленький аватар участника: голова Румика (флаг rumik_table) или кружок с
 * кольцом «говорит» по уровню голоса. Строки списка, лента под сценой,
 * мини-комната поверх игры.
 */
export const LiveAvatar = memo(function LiveAvatar(props: LiveAvatarProps) {
  return useRumikTable() ? <LiveHead {...props} /> : <LiveCircle {...props} />;
});

/**
 * Кружок с кольцом «говорит» по уровню голоса. Уровень меняется часто, поэтому
 * он подписан здесь, а не в месте: перерисовывается только кружок.
 */
function LiveCircle({ p, name, colorIndex, size, speaking, status, surface }: LiveAvatarProps) {
  const level = useAudioLevel(p);
  return (
    <Avatar
      name={name}
      colorIndex={colorIndex}
      size={size}
      speaking={speaking}
      level={level}
      status={status}
      surface={surface}
    />
  );
}

/** Голова Румика: «говорит» — обводкой, без подписки на уровень голоса. */
function LiveHead({ p, name, colorIndex, size, speaking, status, surface }: LiveAvatarProps) {
  const paint = useAvatarPaint(p);
  return (
    <RumikAvatar
      name={name}
      colorIndex={colorIndex}
      paint={paint}
      size={size}
      speaking={speaking}
      status={status}
      surface={surface}
    />
  );
}

/**
 * Румик во весь рост на месте за столом и значок «говорит» у него. Рисунок и
 * жест реакции слушает сам: новый рисунок и реакция перерисовывают только эту
 * фигуру. Жест меняет позу, а глаза — только без мьюта: перечёркнутое кольцо —
 * правда о микрофоне, её не перебиваем. При «меньше движения» жеста нет вовсе
 * (useReactionGesture). Пока поднята правая кисть, значок «говорит» уходит к
 * правому боку, чтобы её не закрыть (speakingBadgeSpot).
 */
const SeatFigure = memo(function SeatFigure({
  p,
  colorIndex,
  speaking,
  muted,
  lookX,
  lookY,
}: {
  p: Participant;
  colorIndex: number;
  speaking: boolean;
  muted: boolean;
  lookX: number;
  lookY: number;
}) {
  const paint = useAvatarPaint(p);
  const gesture = useReactionGesture(p.identity);
  const pose = gesture?.pose ?? "stand";
  return (
    <>
      <Rumik
        colors={paint ? "white" : colorIndex}
        paint={paint ?? undefined}
        glow={speaking}
        pose={pose}
        eyes={muted ? "muted" : (gesture?.eyes ?? "normal")}
        look={[lookX, lookY]}
      />
      {speaking && <SpeakingBadge pose={pose} />}
    </>
  );
});

/**
 * Где пузырь реакции (ReactionBubble сам встаёт по центру над головой; здесь его
 * переставляют классами обёртки):
 *  • over — поверх самой головы: в строке списка сверху его срезала бы
 *    прокрутка, а сбоку он лёг бы на ник;
 *  • left — слева от кружка: у дальних мест над ним стоит ник;
 *  • beside — слева от ника, на его строке: дальний Румик за столом. Над головой
 *    у него ник, а сбоку от головы в жестах 🔥 и GG подняты руки; на строке
 *    ника нет ни рук, ни значков ни в одной позе.
 */
const BUBBLE: Record<"above" | "over" | "left" | "beside", string> = {
  above: "",
  over: "[&>[data-reaction]]:bottom-auto [&>[data-reaction]]:top-1/2 [&>[data-reaction]]:mb-0 [&>[data-reaction]]:-translate-y-1/2",
  left: "[&>[data-reaction]]:left-auto [&>[data-reaction]]:right-full [&>[data-reaction]]:bottom-auto [&>[data-reaction]]:top-0 [&>[data-reaction]]:mb-0 [&>[data-reaction]]:mr-1 [&>[data-reaction]]:translate-x-0",
  beside:
    "[&>[data-reaction]]:left-auto [&>[data-reaction]]:right-full [&>[data-reaction]]:bottom-auto [&>[data-reaction]]:top-1/2 [&>[data-reaction]]:mb-0 [&>[data-reaction]]:mr-1.5 [&>[data-reaction]]:translate-x-0 [&>[data-reaction]]:-translate-y-1/2",
};
type BubblePlace = keyof typeof BUBBLE;

/** Аватар с пузырём реакции у головы. */
function WithBubble({ identity, place, children }: { identity: string; place: BubblePlace; children: ReactNode }) {
  return (
    <span className={cn("relative inline-grid shrink-0", BUBBLE[place])}>
      {children}
      <ReactionBubble identity={identity} />
    </span>
  );
}

/**
 * Как выглядит место: Румик во весь рост (стол под углом, ряд), кружок за
 * круглым столом (крупно/средне — флаг Румиков выключен), строка списка, чип
 * ленты под сценой.
 */
export type SeatLayout = "figure" | "lg" | "md" | "list" | "chip";

export type ParticipantSeatProps = {
  p: Participant;
  name: string;
  colorIndex: number;
  host: boolean;
  /** Это я. Своё место не кликается: собой не управляют. */
  me: boolean;
  /** Я заглушил этого человека для себя. */
  mutedForMe: boolean;
  /**
   * Свой «звук выкл» и «рация ждёт» — из своих контекстов (SelfSeat), по треку
   * их не видно. У чужого места не задаются: там они из атрибутов участника.
   */
  deafened?: boolean;
  pttIdle?: boolean;
  /**
   * Своё место, пока нас не слышно (переподключение): кольцо «говорит» не
   * зажигаем, а мьют показываем по намерению (micIntentOff), а не по треку —
   * трек в это время снят, и место врало бы «микрофон выключен» (ревью М6).
   */
  unheard?: boolean;
  micIntentOff?: boolean;
  layout: SeatLayout;
  /** Подпись над аватаром — для мест в верхней половине стола. */
  labelAbove?: boolean;
  /** Куда смотрит Румик (к центру стола) — сдвиг глаз, только layout="figure". */
  lookX?: number;
  lookY?: number;
  /** Открыть панель участника у места. */
  onOpen?: (p: Participant, el: HTMLElement) => void;
};

/**
 * Место участника. Корень — кнопка (чужое место) или группа (своё) с
 * data-testid="participant", data-identity, data-speaking и всем состоянием в
 * aria-label одной фразой; содержимое для скринридера скрыто.
 */
export const ParticipantSeat = memo(function ParticipantSeat({
  p,
  name,
  colorIndex,
  host,
  me,
  mutedForMe,
  deafened = false,
  pttIdle = false,
  unheard = false,
  micIntentOff,
  layout,
  labelAbove = false,
  lookX = 0,
  lookY = 0,
  onOpen,
}: ParticipantSeatProps) {
  const liveSpeaking = useIsSpeaking(p);
  const trackMicOff = useMicOff(p);
  const forceMuted = useForceMuted(p);
  const streaming = useIsStreaming(p);
  const quality = useLinkQuality(p);
  const remote = useVoiceAttributes(p);
  const manual = useStatusAttributes(p);
  const poorLink = isPoorLink(quality);
  const speaking = liveSpeaking && !unheard;
  const micOff = unheard && micIntentOff !== undefined ? micIntentOff : trackMicOff;
  const status = seatStatus(
    me
      ? { forceMuted, deafened, pttIdle, micOff }
      : remoteSeatVoice({ forceMuted, micOff, deafened: remote.deafened, ptt: remote.ptt }),
  );
  const label = seatLabel({
    name,
    me,
    host,
    speaking,
    status,
    streaming,
    poorLink,
    mutedForMe,
    manual: statusWords(manual),
  });

  const avatar = (size: AvatarSize, surface?: AvatarSurface, withStatus = true, place: BubblePlace = "above") => (
    <WithBubble identity={p.identity} place={place}>
      <LiveAvatar
        p={p}
        name={name}
        colorIndex={colorIndex}
        size={size}
        speaking={speaking}
        status={withStatus ? status : null}
        surface={surface}
      />
    </WithBubble>
  );
  const figure = layout === "figure";
  const nameLine = (className: string) => (
    <SeatName
      name={name}
      short={shortName(
        name,
        nameBudget(layout, {
          host,
          me,
          mutedForMe,
          streaming: figure && streaming,
          poorLink: figure && poorLink,
          manual: manual.kind !== null,
        }),
      )}
      host={host}
      me={me}
      mutedForMe={mutedForMe}
      manual={manual}
      className={className}
    />
  );
  const linkText = quality === "lost" ? "нет связи" : "слабая связь";

  let body: ReactNode;
  let shell: string;
  if (figure) {
    // Румик во весь рост: «говорит» — обводка по силуэту, свечение и значок с
    // полосками у головы; мьют — значок у руки (и перечёркнутое кольцо в
    // глазах). Подпись — одной строкой: корона, ник, «Экран», связь.
    shell = cn(SEAT_FRAME_CLASS, "rounded-card");
    body = (
      <>
        <SeatFigure
          p={p}
          colorIndex={colorIndex}
          speaking={speaking}
          muted={status === "muted" || status === "forceMuted"}
          lookX={lookX}
          lookY={lookY}
        />
        <SeatStatusBadge status={status} />
        {!labelAbove && (
          <span className="pointer-events-none absolute" style={SEAT_HEAD_STYLE}>
            <ReactionBubble identity={p.identity} />
          </span>
        )}
        <SeatLabel above={labelAbove} speaking={speaking}>
          {labelAbove && (
            // Тень текста подписи пузырю не нужна.
            <span className={cn("pointer-events-none absolute inset-0 [text-shadow:none]", BUBBLE.beside)}>
              <ReactionBubble identity={p.identity} />
            </span>
          )}
          {nameLine("min-w-0")}
          {streaming && (
            <Badge tone="signal" size="sm" icon="monitor" caps>
              <span className="hidden @[760px]/arena:inline">Экран</span>
            </Badge>
          )}
          {poorLink && <SignalBars quality={quality} label="" className="shrink-0" />}
        </SeatLabel>
      </>
    );
  } else if (layout === "list") {
    // Строка списка, как голосовой канал Discord: состояние — крупными
    // значками справа, а не крошечным значком в углу аватара (ревью М3).
    shell = "flex h-12 w-full items-center gap-3 rounded-card px-2 text-left";
    body = (
      <>
        {avatar("sm", undefined, false, "over")}
        {nameLine("min-w-0 flex-1 text-body")}
        <span className="flex shrink-0 items-center gap-2.5">
          {streaming && (
            <Badge tone="signal" icon="monitor" caps>
              Экран
            </Badge>
          )}
          {poorLink && <SignalBars quality={quality} label="" />}
          {status && <ListStatus status={status} />}
        </span>
      </>
    );
  } else if (layout === "chip") {
    // Мьют — значком после ника, как в строке списка: в углу головы 32 px он
    // закрывал бы лицо и терялся.
    shell = "flex h-11 items-center gap-2 rounded-full border border-line bg-raised py-1 pl-1 pr-3.5";
    body = (
      <>
        {avatar("sm", "raised", false)}
        {nameLine("max-w-32 text-label")}
        {streaming && <Icon name="monitor" size={14} className="shrink-0 text-signal-ink" />}
        {poorLink && <SignalBars quality={quality} label="" />}
        {status && <ListStatus status={status} compact />}
      </>
    );
  } else {
    const lg = layout === "lg";
    shell = cn(
      "flex items-center rounded-card px-2 py-2 text-center",
      labelAbove ? "flex-col-reverse" : "flex-col",
      // Зазор с запасом: волна вокруг говорящего не должна задевать подпись.
      lg ? "w-36 gap-3" : "w-28 gap-2",
    );
    body = (
      <>
        {avatar(lg ? "lg" : "md", undefined, true, labelAbove ? "left" : "above")}
        {nameLine(lg ? "max-w-[128px] text-body" : "max-w-[104px] text-label")}
        {(streaming || poorLink) && (
          <span className="flex items-center gap-1.5">
            {streaming && (
              <Badge tone="signal" size="sm" icon="monitor" caps>
                Экран
              </Badge>
            )}
            {poorLink && (
              <span className="flex items-center gap-1 text-caption text-caution-ink">
                <SignalBars quality={quality} label="" />
                {linkText}
              </span>
            )}
          </span>
        )}
      </>
    );
  }

  const content = (
    <span aria-hidden="true" className="contents">
      {body}
    </span>
  );
  if (me || !onOpen) {
    return (
      <div
        role="group"
        aria-label={label}
        data-testid="participant"
        data-identity={p.identity}
        data-speaking={speaking}
        className={shell}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      data-testid="participant"
      data-identity={p.identity}
      data-speaking={speaking}
      onClick={(e) => onOpen(p, e.currentTarget)}
      className={cn(shell, "transition-colors duration-140 hover:bg-wash-1")}
    >
      {content}
    </button>
  );
});

/**
 * Своё место: «звук выкл» и «рация ждёт» по треку не видны — берём их из своих
 * контекстов. Отдельный компонент, чтобы переключение своего микрофона
 * перерисовывало только своё место, а не всю раскладку.
 */
export function SelfSeat(props: Omit<ParticipantSeatProps, "deafened" | "pttIdle" | "unheard" | "micIntentOff">) {
  const mic = useMic();
  const { deafened } = useDeafen();
  const { reconnecting } = useRoomLink();
  return (
    <ParticipantSeat
      {...props}
      deafened={deafened}
      pttIdle={mic.state === "ptt-idle"}
      unheard={reconnecting}
      micIntentOff={!mic.enabled}
    />
  );
}

/**
 * Корона, ник, «· вы», значок своего статуса (🕹️ 💤 🎧, словами — в подсказке)
 * и значок «заглушён для вас». Длинный ник режем сами (shortName): у CSS-обрезки
 * между «…» и «· вы» остаётся дыра. Целиком он — в подсказке при наведении и в
 * aria-label места.
 */
function SeatName({
  name,
  short,
  host,
  me,
  mutedForMe,
  manual,
  className,
}: {
  name: string;
  short: string;
  host: boolean;
  me: boolean;
  mutedForMe: boolean;
  manual: PublicStatus;
  className?: string;
}) {
  const words = statusWords(manual);
  const text = <span className={cn("truncate", mutedForMe && "text-ink-3")}>{short}</span>;
  return (
    <span className={cn("flex min-w-0 items-center gap-1 font-medium text-ink", className)}>
      {host && <Icon name="crown" size={14} className="shrink-0 text-crown" />}
      {short === name ? (
        text
      ) : (
        <Tooltip content={name} className="min-w-0">
          {text}
        </Tooltip>
      )}
      {me && <span className="shrink-0 font-normal text-ink-3">· вы</span>}
      {manual.kind && words && (
        <Tooltip content={words.charAt(0).toUpperCase() + words.slice(1)} className="shrink-0">
          <span data-status={manual.kind} className="inline-flex leading-none [text-shadow:none]">
            <Glyph spec={STATUS_VIEW[manual.kind].glyph} size={14} />
          </span>
        </Tooltip>
      )}
      {mutedForMe && <Icon name="volume-off" size={14} className="shrink-0 text-ink-3" />}
    </span>
  );
}

const LIST_STATUS: Record<Exclude<AvatarStatus, "forceMuted">, { icon: IconName; cls: string }> = {
  muted: { icon: "mic-off", cls: "text-alert-ink" },
  deafened: { icon: "headphones-off", cls: "text-alert-ink" },
  ptt: { icon: "radio", cls: "text-ink-2" },
};

/**
 * Состояние голоса справа в строке списка — значком 18 px, как в Discord
 * (compact — 16 px в чипе ленты под сценой). «Хост заглушил» — красной
 * заливкой: это не выбор человека (как на аватаре).
 */
function ListStatus({ status, compact = false }: { status: AvatarStatus; compact?: boolean }) {
  if (status === "forceMuted") {
    return (
      <span
        className={cn("grid shrink-0 place-items-center rounded-full bg-alert text-on-alert", compact ? "size-5" : "size-6")}
      >
        <Icon name="mic-off" size={compact ? 12 : 14} strokeWidth={2.4} />
      </span>
    );
  }
  const view = LIST_STATUS[status];
  return <Icon name={view.icon} size={compact ? 16 : 18} className={cn("shrink-0", view.cls)} />;
}
