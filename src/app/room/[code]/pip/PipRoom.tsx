"use client";

import { memo, useCallback, useEffect, useSyncExternalStore } from "react";
import { useRoomContext, useSpeakingParticipants } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { IconButton, Logo, SignalBars, UiRoot, avatarColorIndex, cn } from "@/components/ui";
import { actionForKey, isTypingTarget } from "@/lib/room/hotkeys";
import { pipVisibleCount, remoteSeatVoice, seatStatus } from "@/lib/room/seat";
import { useDeafen } from "../audio/useDeafen";
import { useMic } from "../audio/useMic";
import { useIsSpeaking } from "../audio/useSpeaking";
import { useVoiceAttributes } from "../audio/useVoicePresence";
import { LiveAvatar, useLinkQuality, useMicOff } from "../participants/ParticipantCircle";
import { displayName, usePeople, avatarColorMap } from "../participants/useAvatarColors";
import { bindsPref } from "../state/prefs";
import { useRoomActions } from "../state/RoomActions";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { useForceMuted } from "../state/useRoomMeta";
import { ReactionBubble } from "../reactions/ReactionBubble";

/** Ниже этой высоты окно — сжатое: только аватары и микрофон. */
const COMPACT_BELOW = 100;

/**
 * Содержимое мини-комнаты поверх игры (Document PiP). Рисуется порталом в окно PiP,
 * поэтому живёт в контекстах комнаты, как всё остальное. Кто говорит (кольца),
 * микрофон, звук, «Говорит Тёма» и «Вернуться». Подсказок и поповеров здесь нет:
 * они считают координаты по главному окну.
 */
export default function PipRoom({ win, title, onClose }: { win: Window; title: string; onClose: () => void }) {
  const subscribe = useCallback(
    (cb: () => void) => {
      win.addEventListener("resize", cb);
      return () => win.removeEventListener("resize", cb);
    },
    [win],
  );
  const height = useSyncExternalStore(subscribe, () => win.innerHeight, () => 184);
  const width = useSyncExternalStore(subscribe, () => win.innerWidth, () => 360);
  usePipHotkeys(win);

  const people = usePeople();
  const colors = avatarColorMap(people);
  const compact = height < COMPACT_BELOW;
  const shown = people.slice(0, pipVisibleCount(people.length, width, compact));
  const rest = people.length - shown.length;

  return (
    <UiRoot className="fixed inset-0 overflow-hidden">
      {compact ? (
        <div className="flex h-full items-center gap-2 px-0.5 pr-2.5">
          {/* Поля внутри списка: кольцо «говорит» выходит за аватар и не должно обрезаться. */}
          <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden p-2" aria-label="Участники">
            {shown.map((p) => (
              <li key={p.identity}>
                {p.isLocal ? (
                  <PipSelf p={p} colorIndex={colors.get(p.identity)} compact />
                ) : (
                  <PipPerson p={p} colorIndex={colors.get(p.identity)} compact />
                )}
              </li>
            ))}
            {rest > 0 && <li className="text-caption tabular-nums text-ink-3">+{rest}</li>}
          </ul>
          <PipMic />
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <Logo variant="mark" height={16} title="" className="shrink-0 text-ink" />
            <span className="min-w-0 truncate text-label font-medium text-ink">{title}</span>
            <PipLink />
          </div>
          <ul className="flex flex-1 items-center justify-center gap-3 px-3" aria-label="Участники">
            {shown.map((p) => (
              <li key={p.identity}>
                {p.isLocal ? (
                  <PipSelf p={p} colorIndex={colors.get(p.identity)} />
                ) : (
                  <PipPerson p={p} colorIndex={colors.get(p.identity)} />
                )}
              </li>
            ))}
            {rest > 0 && <li className="text-label tabular-nums text-ink-3">+{rest}</li>}
          </ul>
          <div className="flex items-center gap-2 px-3 pb-3">
            <PipMic />
            <PipDeafen />
            <PipTalker />
            <IconButton icon="maximize" label="Вернуться в комнату" size="sm" tooltip={false} onClick={onClose} />
          </div>
        </div>
      )}
    </UiRoot>
  );
}

type PipPersonProps = {
  p: Participant;
  colorIndex: number | undefined;
  compact?: boolean;
  /** Свои «звук выкл» и «рация ждёт» — только у себя (PipSelf); у других — из атрибутов. */
  deafened?: boolean;
  pttIdle?: boolean;
};

/** Человек в мини-комнате: аватар с кольцом и короткое имя. */
const PipPerson = memo(function PipPerson({
  p,
  colorIndex,
  compact = false,
  deafened = false,
  pttIdle = false,
}: PipPersonProps) {
  const name = displayName(p);
  const speaking = useIsSpeaking(p);
  const micOff = useMicOff(p);
  const forceMuted = useForceMuted(p);
  const remote = useVoiceAttributes(p);
  const status = seatStatus(
    p.isLocal
      ? { forceMuted, micOff, deafened, pttIdle }
      : remoteSeatVoice({ forceMuted, micOff, deafened: remote.deafened, ptt: remote.ptt }),
  );
  // Реакция — поверх головы: над ней в маленьком окне места нет.
  const avatar = (
    <span className="relative inline-flex [&>[data-reaction]]:bottom-auto [&>[data-reaction]]:top-1/2 [&>[data-reaction]]:mb-0 [&>[data-reaction]]:-translate-y-1/2">
      <LiveAvatar
        p={p}
        name={name}
        colorIndex={colorIndex ?? avatarColorIndex(name)}
        size={compact ? "sm" : "md"}
        speaking={speaking}
        status={status}
      />
      <ReactionBubble identity={p.identity} />
    </span>
  );
  if (compact) return avatar;
  return (
    <span className="flex w-[50px] flex-col items-center gap-1.5">
      {avatar}
      <span className={cn("w-full truncate text-center text-caption", speaking ? "text-ink" : "text-ink-3")}>
        {p.isLocal ? "Вы" : name.split(" ")[0]}
      </span>
    </span>
  );
});

/**
 * Себя — как SelfSeat в комнате: «звук выкл» и «рация ждёт» из своих контекстов,
 * чтобы переключения своего микрофона не перерисовывали чужие аватары.
 */
function PipSelf(props: Omit<PipPersonProps, "deafened" | "pttIdle">) {
  const mic = useMic();
  const { deafened } = useDeafen();
  return <PipPerson {...props} deafened={deafened} pttIdle={mic.state === "ptt-idle"} />;
}

/** Связь с сервером — столбики без пинга: мини-комната не опрашивает статистику. */
function PipLink() {
  const room = useRoomContext();
  return (
    <span className="ml-auto flex items-center">
      <SignalBars quality={useLinkQuality(room.localParticipant)} />
    </span>
  );
}

function PipMic() {
  const mic = useMic();
  const { toggleMic } = useRoomActions();
  const off = mic.state === "off" || mic.state === "forced" || !!mic.error;
  return (
    <IconButton
      icon={mic.state === "ptt-idle" || mic.state === "ptt-talk" ? "radio" : off ? "mic-off" : "mic"}
      label="Микрофон"
      pressed={mic.state === "on" || mic.state === "ptt-talk"}
      variant={off ? "danger" : mic.state === "ptt-talk" ? "signal" : "soft"}
      size="md"
      shape="round"
      disabled={mic.state === "forced"}
      tooltip={false}
      onClick={() => (mic.error ? mic.retry() : toggleMic())}
    />
  );
}

function PipDeafen() {
  const { deafened } = useDeafen();
  const { toggleDeafen } = useRoomActions();
  return (
    <IconButton
      icon={deafened ? "headphones-off" : "headphones"}
      label="Звук"
      pressed={deafened}
      variant={deafened ? "danger" : "soft"}
      size="md"
      shape="round"
      tooltip={false}
      onClick={toggleDeafen}
    />
  );
}

/** «Говорит Тёма» — самый громкий из говорящих. */
function PipTalker() {
  const speakers = useSpeakingParticipants();
  const talker = speakers[0];
  return (
    <span className="min-w-0 flex-1 truncate text-caption text-ink-3" aria-live="polite">
      {talker ? (
        <>
          Говорит <span className="text-ink">{talker.isLocal ? "вы" : displayName(talker)}</span>
        </>
      ) : (
        "Тихо"
      )}
    </span>
  );
}

/**
 * Клавиши микрофона и звука работают и в мини-комнате: фокус там — главное окно
 * нажатий не слышит.
 */
function usePipHotkeys(win: Window) {
  const { toggleMic, toggleDeafen } = useRoomActions();
  const [binds] = usePersistentState(bindsPref);
  const ref = useLatestRef({ binds, toggleMic, toggleDeafen });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const { binds: b, toggleMic: mic, toggleDeafen: deafen } = ref.current;
      const action = actionForKey(b, e.code);
      if (action === "mic") mic();
      else if (action === "deafen") deafen();
      else return;
      e.preventDefault();
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [win, ref]);
}
