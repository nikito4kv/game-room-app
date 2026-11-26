"use client";

import { useEffect, useId, useState } from "react";
import {
  useConnectionQualityIndicator,
  useIsMuted,
  useParticipantTracks,
  useRoomContext,
} from "@livekit/components-react";
import { RoomEvent, Track, type Participant } from "livekit-client";
import type { ModerationCommand } from "@/lib/api/contract";
import {
  Avatar,
  MenuConfirm,
  MenuLabel,
  Popover,
  PopoverItem,
  SignalBars,
  Slider,
  Switch,
  toast,
  type ConnectionQuality,
  type IconName,
  type Rect,
  type Side,
} from "@/components/ui";
import { RumikAvatar } from "@/components/ui/Avatar";
import { Glyph } from "@/components/ui/Glyph";
import { remoteSeatVoice, seatStatus, seatStatusText } from "@/lib/room/seat";
import { useVoiceAttributes } from "../audio/useVoicePresence";
import { useAvatarPaint } from "../avatar/useAvatarPaint";
import { openReport } from "../report/reportStore";
import { useRoomConfig } from "../state/useRoomConfig";
import { useModeration } from "../state/useModeration";
import { useParticipantMeta, useRoomMeta } from "../state/useRoomMeta";
import { useVolumes } from "../state/volumes";
import { useStatusAttributes } from "../status/useStatus";
import { STATUS_VIEW, statusWords } from "../status/view";
import { displayName, useAvatarColors } from "./useAvatarColors";

const QUALITY_TEXT: Record<ConnectionQuality, string> = {
  excellent: "связь отличная",
  good: "связь хорошая",
  poor: "связь слабая",
  lost: "связь пропала",
  unknown: "связь неизвестна",
};

const SCREEN_SOURCES = [Track.Source.ScreenShare];

type View = "actions" | "kick" | "ban" | "transfer";

/**
 * Панель участника по клику на его место: громкость «для вас» и «Заглушить для
 * себя», а хосту — ещё права: сделать хостом, выключить микрофон, запретить чат,
 * разрешить показ экрана, остановить показ, выгнать и забанить (передача прав,
 * кик и бан — с подтверждением прямо в панели). Сама закрывается, если человек вышел.
 */
export default function ParticipantMenu({
  p,
  anchor,
  side,
  onClose,
}: {
  p: Participant;
  /** Прямоугольник места участника на экране. */
  anchor: Rect;
  /** Куда открыть — наружу от стола. */
  side: Side;
  onClose: () => void;
}) {
  const room = useRoomContext();
  const name = displayName(p);

  // Человек вышел, пока панель открыта, — его действия уже не сработают.
  useEffect(() => {
    const onLeft = (left: Participant) => {
      if (left.identity === p.identity) onClose();
    };
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
    };
  }, [room, p.identity, onClose]);

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      anchor={anchor}
      side={side}
      align={side === "bottom" ? "center" : "start"}
      offset={4}
      aria-label={`Участник ${name}`}
      data-testid="participant-menu"
    >
      <ParticipantPanel p={p} name={name} onClose={onClose} />
    </Popover>
  );
}

function ParticipantPanel({ p, name, onClose }: { p: Participant; name: string; onClose: () => void }) {
  const [view, setView] = useState<View>("actions");
  const [busy, setBusy] = useState<ModerationCommand["action"] | null>(null);
  const { moderate } = useModeration();
  const { amHost, amOwner, ownerIdentity, settings } = useRoomMeta();
  const meta = useParticipantMeta(p);
  const colors = useAvatarColors();
  const { quality } = useConnectionQualityIndicator({ participant: p });
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const voiceAttrs = useVoiceAttributes(p);
  const manual = useStatusAttributes(p);
  const manualWords = statusWords(manual);
  const sharing = useParticipantTracks(SCREEN_SOURCES, p.identity).length > 0;
  const { voice, mutes, setVoice, setMuted } = useVolumes();
  const muteId = useId();
  const { flags } = useRoomConfig();
  const paint = useAvatarPaint(p);

  const volume = Math.round((voice[p.identity] ?? 1) * 100);
  const mutedForMe = !!mutes[p.identity];
  const isOwner = p.identity === ownerIdentity;

  /**
   * Действие хоста; done — что сказать после успеха, close — закрыть панель,
   * toastId — свой id тоста (по умолчанию новый).
   */
  async function run(
    command: ModerationCommand,
    after?: { done?: string; icon?: IconName; close?: boolean; toastId?: string },
  ) {
    setBusy(command.action);
    const r = await moderate(command);
    setBusy(null);
    if (!r.ok) {
      setView("actions");
      return;
    }
    if (after?.done) toast({ id: after.toastId, title: name, description: after.done, icon: after.icon });
    if (after?.close) onClose();
  }

  if (view === "transfer") {
    return (
      <MenuConfirm
        title="Передать права хоста?"
        // Ник не склоняем: имя — подлежащее в пояснении.
        description={
          amOwner
            ? `${name} станет хостом. Вернуть права можно в меню комнаты.`
            : `${name} станет хостом, а вы станете обычным участником. Вернуть права сможет только новый хост.`
        }
        confirmLabel="Передать"
        // Владелец вернёт права в любой момент — это не необратимо, кнопка не красная.
        tone={amOwner ? "neutral" : "danger"}
        busy={busy !== null}
        onConfirm={() => void run({ action: "transfer", target: p.identity }, { close: true })}
        onCancel={() => setView("actions")}
      />
    );
  }

  if (view === "kick" || view === "ban") {
    const kick = view === "kick";
    return (
      <MenuConfirm
        // Ник не склоняем: имя — подлежащее в пояснении.
        title={kick ? "Выгнать из комнаты?" : "Забанить в этой комнате?"}
        description={
          kick
            ? `${name} сможет вернуться через 5 минут.`
            : `${name} не сможет зайти, пока комната открыта. Снять бан можно в настройках комнаты.`
        }
        confirmLabel={kick ? "Выгнать" : "Забанить"}
        busy={busy !== null}
        onConfirm={() =>
          void run(
            { action: view, target: p.identity },
            // Тот же id, что у тоста «вышел» (feed/useRoomToasts): уход выгнанного
            // не добавит второй тост об одном человеке, а обновит этот на месте.
            kick
              ? { done: "выгнали на 5 минут", icon: "user-x", close: true, toastId: `peer-${p.identity}` }
              : { done: "забанили в этой комнате", icon: "ban", close: true, toastId: `peer-${p.identity}` },
          )
        }
        onCancel={() => setView("actions")}
      />
    );
  }

  // То же, что значок на месте: «звук выкл» и рация — из атрибутов, мьют — по треку.
  const status = seatStatus(
    remoteSeatVoice({
      forceMuted: meta.forceMuted,
      micOff: micMuted,
      deafened: voiceAttrs.deafened,
      ptt: voiceAttrs.ptt,
    }),
  );
  return (
    <div className="flex w-72 max-w-full flex-col">
      <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
        {flags.rumik_table ? (
          <RumikAvatar
            name={name}
            colorIndex={colors.get(p.identity)}
            paint={paint}
            size="md"
            status={status}
            surface="overlay"
          />
        ) : (
          <Avatar name={name} colorIndex={colors.get(p.identity)} size="md" status={status} surface="overlay" />
        )}
        <div className="min-w-0">
          <p className="truncate text-title text-ink">{name}</p>
          {manual.kind && manualWords && (
            <p className="truncate text-label text-ink-2" data-testid="participant-status">
              <span className="inline-flex items-center gap-1.5">
                <Glyph spec={STATUS_VIEW[manual.kind].glyph} size={14} />
                {manualWords}
              </span>
            </p>
          )}
          {/* Состояние голоса — первым и целиком: «в режиме рации» объясняет, почему
              человек молчит. Связь при нехватке места ужимается — её видно по столбикам. */}
          <p className="flex items-center gap-1.5 text-label text-ink-3">
            {status && <span className="shrink-0 text-ink-2">{seatStatusText(status)} ·</span>}
            <SignalBars quality={quality} />
            <span className="truncate">{QUALITY_TEXT[quality]}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-line px-2.5 py-3">
        <Slider
          label="Громкость для вас"
          value={mutedForMe ? 0 : volume}
          onValueChange={(v) => setVoice(p.identity, v / 100)}
          max={200}
          step={5}
          marks={[100]}
          snap={4}
          formatValue={(v) => `${v}%`}
          disabled={mutedForMe}
        />
        <div className="mt-1 flex items-center justify-between gap-3">
          <label htmlFor={muteId} className="cursor-pointer text-body text-ink">
            Заглушить для себя
          </label>
          <Switch
            id={muteId}
            size="sm"
            checked={mutedForMe}
            onCheckedChange={(m) => setMuted(p.identity, m)}
          />
        </div>
      </div>

      {flags.reports && !p.isLocal && (
        <div className="flex flex-col border-t border-line py-1.5">
          <PopoverItem
            icon="flag"
            onClick={() => {
              onClose();
              openReport({ identity: p.identity, name });
            }}
            data-testid="report-person"
          >
            Пожаловаться…
          </PopoverItem>
        </div>
      )}

      {amHost && (
        <div className="flex flex-col border-t border-line pt-1.5" data-testid="host-actions">
          <MenuLabel>Вы хост</MenuLabel>
          <PopoverItem
            icon="crown"
            disabled={busy !== null}
            onClick={() => setView("transfer")}
            data-testid="host-transfer"
          >
            Сделать хостом…
          </PopoverItem>
          {!isOwner && (
            <PopoverItem
              icon={meta.forceMuted ? "mic" : "mic-off"}
              busy={busy === "mute" || busy === "unmute"}
              disabled={busy !== null}
              onClick={() => void run({ action: meta.forceMuted ? "unmute" : "mute", target: p.identity })}
              data-testid="host-mute"
            >
              {meta.forceMuted ? "Вернуть микрофон" : "Выключить микрофон"}
            </PopoverItem>
          )}
          {!isOwner && (
            <PopoverItem
              icon={meta.chatMuted ? "chat" : "chat-off"}
              busy={busy === "chatMute" || busy === "chatUnmute"}
              disabled={busy !== null}
              onClick={() =>
                void run(
                  { action: meta.chatMuted ? "chatUnmute" : "chatMute", target: p.identity },
                  { done: meta.chatMuted ? "снова может писать в чат" : "не может писать в чат", icon: "chat-off" },
                )
              }
              data-testid="host-chat"
            >
              {meta.chatMuted ? "Разрешить чат" : "Запретить чат"}
            </PopoverItem>
          )}
          {settings.screen === "approved" && (
            <PopoverItem
              icon={meta.screenAllowed ? "screen-stop" : "screen-share"}
              busy={busy === "allowScreen" || busy === "disallowScreen"}
              disabled={busy !== null}
              onClick={() =>
                void run(
                  { action: meta.screenAllowed ? "disallowScreen" : "allowScreen", target: p.identity },
                  {
                    done: meta.screenAllowed ? "не может показывать экран" : "может показывать экран",
                    icon: "screen-share",
                  },
                )
              }
              data-testid="host-screen"
            >
              {meta.screenAllowed ? "Запретить показ экрана" : "Разрешить показ экрана"}
            </PopoverItem>
          )}
          {sharing && (
            <PopoverItem
              icon="screen-stop"
              busy={busy === "stopScreen"}
              disabled={busy !== null}
              onClick={() => void run({ action: "stopScreen", target: p.identity }, { close: true })}
              data-testid="host-stop-screen"
            >
              Остановить показ
            </PopoverItem>
          )}
          {isOwner ? (
            <p className="px-2.5 pb-2 pt-1 text-caption text-ink-3">
              Это создатель комнаты: его нельзя заглушить, выгнать или забанить.
            </p>
          ) : (
            <>
              <div className="-mx-1.5 my-1.5 h-px bg-line" />
              <PopoverItem
                icon="user-x"
                tone="danger"
                disabled={busy !== null}
                onClick={() => setView("kick")}
                data-testid="host-kick"
              >
                Выгнать…
              </PopoverItem>
              <PopoverItem
                icon="ban"
                tone="danger"
                disabled={busy !== null}
                onClick={() => setView("ban")}
                data-testid="host-ban"
              >
                Забанить…
              </PopoverItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}
