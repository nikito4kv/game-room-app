"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toMicError, type MicError } from "@/lib/audio/micErrors";
import { startMicTest, startMicTestFromProcessor, type MicTest } from "@/lib/audio/micTest";
import { CALIBRATION_UNAVAILABLE } from "@/lib/audio/voiceNode";
import { loadVoiceProfile, profileKey } from "@/lib/audio/voiceProfiles";
import type { CalibrationResult } from "@/lib/audio/worklet/protocol";
import type { VoiceControls } from "../audio/useMic";
import { useLatestRef } from "../state/useLatestRef";

/** Сколько длится калибровка «скажите фразу». */
export const CALIBRATION_MS = 3000;

export type VoiceMonitor = {
  /**
   * Откуда полоса уровня: «room» — микрофон комнаты (он в эфире), «test» —
   * проверочный захват того же микрофона (микрофон выключен или рация ждёт:
   * полоса и калибровка работают, а в эфир ничего не уходит).
   */
  source: "room" | "test";
  /** Уровень, который сравнивается с порогом (после шумодава), дБFS. Для rAF полосы. */
  getLevelDb: () => number;
  /** Порог «Авто» сейчас, дБFS (NaN — ещё не знаем). Обновляется, когда сдвинется на 1 дБ. */
  autoThresholdDb: number;
  /** Проверочный захват не открылся. */
  error: MicError | null;
  calibrate: () => Promise<CalibrationResult>;
  loopback: boolean;
  setLoopback: (on: boolean) => void;
};

/**
 * Источник полосы уровня, калибровки и «Слышать себя» для вкладки «Голос».
 * Пока микрофон в эфире (открытый микрофон), слушаем обработку комнаты — без
 * второго захвата. Иначе поднимаем проверочный захват с той же обработкой:
 * человек с выключенным микрофоном или в режиме рации тоже видит свой уровень
 * и может откалибровать порог, ничего не передавая друзьям.
 */
export function useVoiceMonitor(voice: VoiceControls): VoiceMonitor {
  const fromRoom = voice.mode === "toggle" && voice.live && voice.running;
  const deviceId = voice.inputFallback ? "default" : voice.inputChoice;
  const settingsRef = useLatestRef(voice.settings);
  // Эхо, автогромкость и шумодав браузера задаются при захвате — как у комнаты
  // (Chrome не держит разную обработку на одном микрофоне); сменились — захватываем заново.
  const { echoCancellation, autoGainControl } = voice.capture;
  const browserNoiseSuppression = voice.browserNoiseSuppression;

  const [test, setTest] = useState<MicTest | null>(null);
  const [error, setError] = useState<MicError | null>(null);
  useEffect(() => {
    if (fromRoom) return;
    let cancelled = false;
    let started: MicTest | null = null;
    startMicTest(deviceId, settingsRef.current.gain, {
      processing: settingsRef.current,
      capture: { echoCancellation, autoGainControl },
      browserNoiseSuppression,
    }).then(
      (t) => {
        if (cancelled) {
          void t.stop();
          return;
        }
        started = t;
        // Тот же микрофон — тот же профиль голоса: порог «Авто» верный с первой секунды.
        const key = t.source && profileKey(t.source);
        const profile = key ? loadVoiceProfile(key) : null;
        if (profile) t.processor?.seedVoiceProfile(profile.voiceDb, profile.noiseDb ?? NaN);
        setTest(t);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(toMicError(e));
      },
    );
    return () => {
      cancelled = true;
      void started?.stop();
      setTest(null);
    };
  }, [fromRoom, deviceId, echoCancellation, autoGainControl, browserNoiseSuppression, settingsRef]);

  // Настройки меняются вживую и у проверочной обработки.
  useEffect(() => {
    test?.processor?.updateSettings(voice.settings);
  }, [test, voice.settings]);

  const processor = fromRoom ? voice.processor : (test?.processor ?? null);
  const levelRef = useRef(-Infinity);
  const [autoThresholdDb, setAutoThresholdDb] = useState(NaN);
  useEffect(() => {
    levelRef.current = -Infinity;
    if (!processor) return;
    return processor.subscribeMeter((m) => {
      levelRef.current = m.levelDb;
      setAutoThresholdDb((prev) => {
        if (!Number.isFinite(m.thresholdDb)) return Number.isNaN(prev) ? prev : NaN;
        return Math.abs(prev - m.thresholdDb) >= 1 || Number.isNaN(prev) ? Math.round(m.thresholdDb) : prev;
      });
    });
  }, [processor]);
  const getLevelDb = useCallback(() => levelRef.current, []);

  // «Слышать себя»: у проверки — свой вывод, у комнаты — прослушивание её выхода.
  const [loopback, setLoopback] = useState(false);
  useEffect(() => {
    if (!loopback) return;
    if (!fromRoom) {
      test?.setLoopback(true);
      return () => test?.setLoopback(false);
    }
    let cancelled = false;
    let monitor: MicTest | null = null;
    startMicTestFromProcessor(voice.processor).then(
      (m) => {
        if (cancelled) {
          void m.stop();
          return;
        }
        monitor = m;
        m.setLoopback(true);
      },
      () => {},
    );
    return () => {
      cancelled = true;
      void monitor?.stop();
    };
  }, [loopback, fromRoom, test, voice.processor]);

  const { calibrate: calibrateRoom, adoptCalibration } = voice;
  const calibrate = useCallback(async (): Promise<CalibrationResult> => {
    if (fromRoom) return calibrateRoom(CALIBRATION_MS);
    const p = test?.processor;
    if (!p) return CALIBRATION_UNAVAILABLE;
    const r = await p.calibrate(CALIBRATION_MS);
    adoptCalibration(r);
    return r;
  }, [fromRoom, test, calibrateRoom, adoptCalibration]);

  return {
    source: fromRoom ? "room" : "test",
    getLevelDb,
    autoThresholdDb,
    error: fromRoom ? null : error,
    calibrate,
    loopback,
    setLoopback,
  };
}
