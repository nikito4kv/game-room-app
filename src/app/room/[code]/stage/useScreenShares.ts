"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoomContext, useTracks, type TrackReference } from "@livekit/components-react";
import { RemoteTrackPublication, Track, type Participant, type Room } from "livekit-client";
import { byAppearance, pickFocus, trackAppearance, type AppearanceOrder } from "@/lib/room/screens";

/** Чужой показ экрана на сцене. */
export type RemoteScreen = {
  sid: string;
  ref: TrackReference;
  participant: Participant;
  /** Зритель сказал «не смотреть»: картинка и звук показа не принимаются. */
  hidden: boolean;
};

export type ScreenShares = {
  /** Чужие показы по времени начала (первым — самый ранний). */
  remote: RemoteScreen[];
  /** Не скрытые из них. */
  visible: RemoteScreen[];
  /** Какой показ крупно; null — сцены нет. */
  focused: RemoteScreen | null;
  /** Свой показ — только для превью по кнопке (на сцену не выводим). */
  local: TrackReference | null;
  /** Выбрать показ для сцены (скрытый — заодно вернуть). */
  focus: (sid: string) => void;
  /** «Не смотреть»: отписаться от картинки и звука показа — экономит канал. */
  hide: (sid: string) => void;
  /** «Смотреть»: подписаться снова и вывести крупно. Без sid — самый новый скрытый. */
  watch: (sid?: string) => void;
};

/** Только публикации и подписки: голос и прочие события список не трогают. */
const SOURCES = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
const NO_EXTRA_EVENTS: never[] = [];

/** Картинка и звук показа по sid картинки. */
function findScreen(room: Room, sid: string) {
  for (const p of room.remoteParticipants.values()) {
    const video = p.trackPublications.get(sid);
    if (video) return { video, audio: p.getTrackPublication(Track.Source.ScreenShareAudio) };
  }
  return null;
}

/**
 * Показы экрана в комнате: порядок по времени начала (аудит C-11), какой
 * крупно, кто скрыт. Скрытие — отписка от дорожек: видео и звук показа не
 * принимаются, а подписка вернётся по «Смотреть». Новый показ того же человека —
 * новая публикация, он снова виден.
 */
export function useScreenShares(): ScreenShares {
  const room = useRoomContext();
  const refs = useTracks(SOURCES, { onlySubscribed: false, updateOnlyOn: NO_EXTRA_EVENTS });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [manual, setManual] = useState<string | null>(null);

  const videoRefs = useMemo(
    () => refs.filter((r) => r.source === Track.Source.ScreenShare && !r.participant.isLocal),
    [refs],
  );
  const local = useMemo(
    () => refs.find((r) => r.source === Track.Source.ScreenShare && r.participant.isLocal) ?? null,
    [refs],
  );
  const sids = useMemo(() => videoRefs.map((r) => r.publication.trackSid), [videoRefs]);
  const sidsKey = sids.join(" ");

  // Порядок появления — состояние, которое подстраивается под новый список
  // прямо при отрисовке (React перерисует сразу, без лишнего кадра).
  const [appearance, setAppearance] = useState<{ key: string; order: AppearanceOrder; nextSeq: number }>(
    () => ({ key: sidsKey, ...trackAppearance(new Map(), sids, 0) }),
  );
  if (appearance.key !== sidsKey) {
    setAppearance({ key: sidsKey, ...trackAppearance(appearance.order, sids, appearance.nextSeq) });
    // Закончившиеся показы забываем и в списке скрытых.
    setHidden((prev) => {
      const next = new Set([...prev].filter((sid) => sids.includes(sid)));
      return next.size === prev.size ? prev : next;
    });
  }

  const remote = useMemo(
    () =>
      byAppearance(videoRefs, (r) => r.publication.trackSid, appearance.order).map<RemoteScreen>((ref) => ({
        sid: ref.publication.trackSid,
        ref,
        participant: ref.participant,
        hidden: hidden.has(ref.publication.trackSid),
      })),
    [videoRefs, appearance.order, hidden],
  );
  const visible = useMemo(() => remote.filter((s) => !s.hidden), [remote]);
  const focusedSid = pickFocus(
    visible.map((s) => s.sid),
    manual,
  );
  const focused = visible.find((s) => s.sid === focusedSid) ?? null;

  // Звук показа может прийти позже картинки — у скрытого показа его тоже не берём.
  useEffect(() => {
    for (const r of refs) {
      if (r.source !== Track.Source.ScreenShareAudio || !(r.publication instanceof RemoteTrackPublication)) continue;
      const screen = r.participant.getTrackPublication(Track.Source.ScreenShare);
      if (screen && hidden.has(screen.trackSid) && r.publication.isDesired) r.publication.setSubscribed(false);
    }
  }, [refs, hidden]);

  const watch = useCallback(
    (sid?: string) => {
      const target = sid ?? remote.filter((s) => s.hidden).at(-1)?.sid;
      if (!target) return;
      const found = findScreen(room, target);
      if (found) {
        if (found.video instanceof RemoteTrackPublication) found.video.setSubscribed(true);
        found.audio?.setSubscribed(true);
      }
      setHidden((prev) => {
        if (!prev.has(target)) return prev;
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
      setManual(target);
    },
    [room, remote],
  );

  const hide = useCallback(
    (sid: string) => {
      const found = findScreen(room, sid);
      if (found) {
        if (found.video instanceof RemoteTrackPublication) found.video.setSubscribed(false);
        found.audio?.setSubscribed(false);
      }
      setHidden((prev) => new Set(prev).add(sid));
      setManual((m) => (m === sid ? null : m));
    },
    [room],
  );

  const focus = useCallback(
    (sid: string) => {
      if (hidden.has(sid)) watch(sid);
      else setManual(sid);
    },
    [hidden, watch],
  );

  return { remote, visible, focused, local, focus, hide, watch };
}
