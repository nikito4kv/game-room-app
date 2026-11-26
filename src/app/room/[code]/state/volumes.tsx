"use client";

import { createContext, use, useCallback, useMemo, type ReactNode } from "react";
import {
  getMasterVolume,
  getParticipantMutes,
  getParticipantVolumes,
  readLocalJSON,
  setMasterVolume,
  setParticipantMute,
  setParticipantVolume,
  writeLocalJSON,
} from "@/lib/clientStorage";
import { isVolumeMap, type VolumeMaps } from "@/lib/room/volume";
import { persistentKey, usePersistentState } from "./usePersistentState";

/** Громкость звука демонстрации по участникам (identity → 0..2). */
const STREAM_VOLUMES_KEY = "gr.audio.streamVolumes";

/** Общая громкость приёма 0…1; мусор из хранилища не даст «500 %». */
const masterPref = persistentKey<number>({
  read: () => Math.min(1, Math.max(0, getMasterVolume())),
  write: setMasterVolume,
  initial: 1,
});
// Карты голоса и мьютов пишутся поштучно: clientStorage выкидывает значения по
// умолчанию, чтобы карта не пухла. Поэтому write у них не задан.
const voicePref = persistentKey<Record<string, number>>({
  read: getParticipantVolumes,
  initial: {},
});
const mutesPref = persistentKey<Record<string, boolean>>({
  read: getParticipantMutes,
  initial: {},
});
const streamPref = persistentKey<Record<string, number>>({
  read: () => readLocalJSON(STREAM_VOLUMES_KEY, {}, isVolumeMap),
  write: (map) => writeLocalJSON(STREAM_VOLUMES_KEY, map),
  initial: {},
});

/**
 * Громкости «для себя» — что и как громко я слышу. Всё переживает перезагрузку.
 * Громкость конкретной дорожки считает trackVolume (@/lib/room/volume).
 */
export type Volumes = VolumeMaps & {
  setMaster: (v: number) => void;
  setVoice: (identity: string, v: number) => void;
  /** Своя громкость звука демонстрации участника; не задана — как его голос. */
  setStream: (identity: string, v: number) => void;
  /** «Заглушить для себя». */
  setMuted: (identity: string, muted: boolean) => void;
};

const VolumesContext = createContext<Volumes | null>(null);

export function VolumesProvider({ children }: { children: ReactNode }) {
  const [master, setMaster] = usePersistentState(masterPref);
  const [voice] = usePersistentState(voicePref);
  const [stream] = usePersistentState(streamPref);
  const [mutes] = usePersistentState(mutesPref);

  const setVoice = useCallback((identity: string, v: number) => {
    voicePref.set((prev) => ({ ...prev, [identity]: v }));
    setParticipantVolume(identity, v);
  }, []);
  const setMuted = useCallback((identity: string, muted: boolean) => {
    mutesPref.set((prev) => ({ ...prev, [identity]: muted }));
    setParticipantMute(identity, muted);
  }, []);
  const setStream = useCallback((identity: string, v: number) => {
    streamPref.set((prev) => ({ ...prev, [identity]: v }));
  }, []);

  const value = useMemo<Volumes>(
    () => ({ master, voice, stream, mutes, setMaster, setVoice, setStream, setMuted }),
    [master, voice, stream, mutes, setMaster, setVoice, setStream, setMuted],
  );
  return <VolumesContext value={value}>{children}</VolumesContext>;
}

export function useVolumes(): Volumes {
  const value = use(VolumesContext);
  if (!value) throw new Error("useVolumes: нет VolumesProvider выше по дереву");
  return value;
}
