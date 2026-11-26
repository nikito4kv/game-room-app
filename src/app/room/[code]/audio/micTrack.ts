"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  ParticipantEvent,
  Track,
  type LocalAudioTrack,
  type LocalParticipant,
} from "livekit-client";

/** Свой опубликованный микрофон (undefined — не опубликован). */
export function getMicTrack(p: LocalParticipant): LocalAudioTrack | undefined {
  return p.getTrackPublication(Track.Source.Microphone)?.audioTrack as LocalAudioTrack | undefined;
}

/**
 * Свой микрофон — реактивно: публикация, снятие, mute/unmute. muted — трек
 * заглушён или его нет (звук не уходит).
 */
export function useMicTrack(p: LocalParticipant): { track: LocalAudioTrack | undefined; muted: boolean } {
  const subscribe = useCallback(
    (onChange: () => void) => {
      p.on(ParticipantEvent.LocalTrackPublished, onChange);
      p.on(ParticipantEvent.LocalTrackUnpublished, onChange);
      p.on(ParticipantEvent.TrackMuted, onChange);
      p.on(ParticipantEvent.TrackUnmuted, onChange);
      return () => {
        p.off(ParticipantEvent.LocalTrackPublished, onChange);
        p.off(ParticipantEvent.LocalTrackUnpublished, onChange);
        p.off(ParticipantEvent.TrackMuted, onChange);
        p.off(ParticipantEvent.TrackUnmuted, onChange);
      };
    },
    [p],
  );
  const track = useSyncExternalStore(subscribe, () => getMicTrack(p), () => undefined);
  const muted = useSyncExternalStore(subscribe, () => getMicTrack(p)?.isMuted ?? true, () => true);
  return { track, muted };
}
