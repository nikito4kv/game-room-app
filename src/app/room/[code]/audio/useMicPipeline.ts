"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TrackEvent, type LocalAudioTrack } from "livekit-client";
import { hasUserActivation, onUserActivation } from "@/lib/audio/activation";
import {
  MicProcessor,
  type CalibrationResult,
  type MicStatus,
  type VoiceSettings,
} from "@/lib/audio/micProcessor";
import { levelFromDb, speakingStore } from "@/lib/audio/speaking";
import { loadVoiceProfile, profileKey, saveVoiceProfile } from "@/lib/audio/voiceProfiles";
import { sanitizeVoiceSettings } from "@/lib/audio/worklet/protocol";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { voiceSettingsPref } from "./voicePrefs";

/** Как часто обновлять сохранённый профиль голоса, пока человек говорит. */
const PROFILE_SAVE_MS = 20_000;
const IDLE: MicStatus = Object.freeze({ state: "idle", blocked: false });

/** Обработка своего голоса — то, что видит и меняет окно настроек. */
export type MicPipeline = {
  /** Процессор комнаты: метрики (subscribeMeter), калибровка, «слышать себя». */
  processor: MicProcessor;
  /** Состояние шумодава — для честного статуса в настройках. */
  status: MicStatus;
  /** Обработка запущена на микрофоне комнаты. */
  running: boolean;
  /** Ждём первого клика или клавиши, чтобы запустить обработку. */
  waitingForGesture: boolean;
  settings: VoiceSettings;
  /** Поменять настройки обработки: сразу в процессор и в хранилище. */
  updateSettings: (patch: Partial<VoiceSettings>) => void;
  /**
   * Вместо нашего шумодава нужен браузерный: наш сломался или ещё не может
   * запуститься (нет жеста). Это не выбор человека и в хранилище не пишется.
   */
  browserNoiseSuppression: boolean;
  /** Калибровка на процессоре комнаты (микрофон должен быть в эфире). */
  calibrate: (ms?: number) => Promise<CalibrationResult>;
  /** Принять калибровку, сделанную на проверочном захвате: засеять процессор и сохранить профиль. */
  adoptCalibration: (result: CalibrationResult) => void;
};

/**
 * Обработка своего микрофона (MicProcessor: RNNoise + умный порог + своя
 * автогромкость + лимитер). Процессор один на комнату: LiveKit гасит его вместе
 * с треком, а на новом треке (вернули микрофон, переподключились) он собирается
 * заново. Вызывать один раз на комнату — в MicProvider.
 *
 *  • Настройки живые: любое изменение сразу уходит в worklet и в localStorage.
 *  • Процессор вешаем только после жеста на странице — иначе контекст стоит на
 *    паузе и в эфир ушла бы тишина (аудит 1-audio, 3.4). До жеста в эфир идёт
 *    микрофон с браузерным шумодавом.
 *  • Профиль голоса (уровни голоса и фона) — свой у каждого микрофона: засеваем
 *    при запуске и смене микрофона, сохраняем после калибровки и раз в 20 с речи.
 *  • «Я говорю» — по порогу (то, что реально уходит в эфир), без сервера.
 */
export function useMicPipeline({
  track,
  live,
  identity,
}: {
  track: LocalAudioTrack | undefined;
  /** Звук сейчас уходит в эфир (трек не заглушён). */
  live: boolean;
  identity: string;
}): MicPipeline {
  const [settings] = usePersistentState(voiceSettingsPref);
  const [processor] = useState(
    () => new MicProcessor(settings.gain, settings.noiseSuppression, undefined, settings),
  );
  const trackRef = useLatestRef(track);

  const subscribeStatus = useCallback((cb: () => void) => processor.onStatus(cb), [processor]);
  const status = useSyncExternalStore(subscribeStatus, () => processor.status, () => IDLE);
  const activated = useSyncExternalStore(onUserActivation, hasUserActivation, () => false);
  const [attachFailed, setAttachFailed] = useState(false);

  useEffect(() => {
    processor.updateSettings(settings);
  }, [processor, settings]);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    voiceSettingsPref.set((prev) => sanitizeVoiceSettings(patch, prev));
  }, []);

  // Повесить процессор на свой микрофон — после жеста. При переподключении
  // LiveKit публикует тот же трек с тем же процессором — второй раз не вешаем.
  useEffect(() => {
    if (!track || !activated || track.getProcessor() === processor) return;
    let cancelled = false;
    track.setProcessor(processor).then(
      () => {
        if (!cancelled) setAttachFailed(false);
      },
      () => {
        // setProcessor помечен @experimental: при сбое звук идёт без нашей
        // обработки, а capture включит браузерный шумодав.
        if (!cancelled) setAttachFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [track, activated, processor]);

  const running = status.state !== "idle";

  // Профиль голоса: засеять при запуске и при смене микрофона (MicProcessor сам
  // забывает уровни, когда меняется устройство).
  useEffect(() => {
    if (!track || !running) return;
    let seededDevice: string | undefined;
    const seed = () => {
      const s = track.getSourceTrackSettings();
      if (s.deviceId === seededDevice) return;
      seededDevice = s.deviceId;
      const key = profileKey(s);
      const p = key ? loadVoiceProfile(key) : null;
      if (p) processor.seedVoiceProfile(p.voiceDb, p.noiseDb ?? NaN);
    };
    seed();
    track.on(TrackEvent.Restarted, seed);
    return () => {
      track.off(TrackEvent.Restarted, seed);
    };
  }, [track, running, processor]);

  // «Я говорю»: порог открыт и звук в эфире. Уровень для кольца и профиль голоса
  // берём из метрик — их слушаем только пока говорим (в тишине ничего не считается).
  const subscribeGate = useCallback((cb: () => void) => processor.onGateChange(cb), [processor]);
  const gateOpen = useSyncExternalStore(subscribeGate, () => processor.isGateOpen, () => false);
  const hasGate = running && !(status.state === "error" && status.reason === "worklet");
  const speaking = hasGate && gateOpen && live;
  const lastSaveRef = useRef(0);
  useEffect(() => {
    if (!hasGate) {
      speakingStore.delete(identity);
      return;
    }
    if (!speaking) {
      speakingStore.set(identity, false, 0);
      return;
    }
    speakingStore.set(identity, true, 0.5);
    return processor.subscribeMeter((m) => {
      speakingStore.set(identity, true, Math.max(0.1, levelFromDb(m.outDb)));
      const now = Date.now();
      if (now - lastSaveRef.current < PROFILE_SAVE_MS) return;
      const key = trackRef.current && profileKey(trackRef.current.getSourceTrackSettings());
      if (key && saveVoiceProfile(key, m.voiceDb, m.noiseDb, now)) lastSaveRef.current = now;
    });
  }, [hasGate, speaking, identity, processor, trackRef]);
  useEffect(() => () => speakingStore.delete(identity), [identity]);

  const saveProfile = useCallback(
    (r: CalibrationResult) => {
      const key = trackRef.current && profileKey(trackRef.current.getSourceTrackSettings());
      if (r.ok && key) saveVoiceProfile(key, r.voiceDb, r.noiseDb);
    },
    [trackRef],
  );
  const calibrate = useCallback(
    async (ms = 3000) => {
      const r = await processor.calibrate(ms);
      saveProfile(r);
      return r;
    },
    [processor, saveProfile],
  );
  const adoptCalibration = useCallback(
    (r: CalibrationResult) => {
      if (!r.ok) return;
      processor.seedVoiceProfile(r.voiceDb, r.noiseDb);
      saveProfile(r);
    },
    [processor, saveProfile],
  );

  const broken = attachFailed || status.state === "error";
  const waitingForGesture = !!track && !activated;
  const browserNoiseSuppression = settings.noiseSuppression && (!activated || broken);
  return useMemo(
    () => ({
      processor,
      status,
      running,
      waitingForGesture,
      settings,
      updateSettings,
      browserNoiseSuppression,
      calibrate,
      adoptCalibration,
    }),
    [
      processor,
      status,
      running,
      waitingForGesture,
      settings,
      updateSettings,
      browserNoiseSuppression,
      calibrate,
      adoptCalibration,
    ],
  );
}
